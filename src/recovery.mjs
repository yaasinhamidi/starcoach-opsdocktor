import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectRepository } from './inspector.mjs';
import { MockDeploymentProvider, planDigest } from './mock-provider.mjs';
import { configuredStartupEntrypoint, createRepairTask, digestSourceSnapshot, FakeCodingAgentAdapter, validateRepairProposal } from './coding-agent.mjs';
import { ProcessFakeCodingAgentAdapter } from './process-coding-agent.mjs';
import { classifyReplayIncident } from './replay-diagnostics.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const REPAIR_PATH = 'package.json';
const BROKEN_COMMAND = 'node missing.mjs';
const FIXED_COMMAND = 'node server.mjs';
const ENTRYPOINT_PATH = 'server.mjs';
const MAX_ENTRYPOINT_BYTES = 256 * 1024;
const SOURCE_ENTRYPOINTS = Object.freeze(['server.mjs', 'app.mjs', 'index.mjs']);

function isEntryPointFailure(line) {
  if (typeof line?.message !== 'string' || !/MODULE_NOT_FOUND|Cannot find module/i.test(line.message)) return false;
  const match = line.message.match(/Cannot find module\s+['"]([^'"]+)['"]/i);
  if (!match) return false;
  const specifier = match[1].replace(/\\/g, '/');
  return specifier === 'missing.mjs' || specifier === './missing.mjs' || specifier === '/app/missing.mjs';
}

async function hasSupportedEntrypoint(root, name = ENTRYPOINT_PATH) {
  try {
    const info = await lstat(join(root, name));
    return info.isFile() && !info.isSymbolicLink() && info.size <= MAX_ENTRYPOINT_BYTES;
  } catch { return false; }
}

async function readRepairSnapshot(root, packageText) {
  const pkg = JSON.parse(packageText);
  let liaraJson = null;
  try {
    const path = join(root, 'liara.json');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error('Invalid deployment contract file');
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'port')) throw new Error('Unsupported deployment contract fields');
    liaraJson = Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535 ? { port: value.port } : null;
  } catch (error) {
    if (error.code !== 'ENOENT') liaraJson = null;
  }
  const existingEntrypoints = [];
  for (const name of SOURCE_ENTRYPOINTS) if (await hasSupportedEntrypoint(root, name)) existingEntrypoints.push(name);
  const packagePort = pkg?.config?.port;
  return {
    packageJson: {
      scriptsStart: typeof pkg?.scripts?.start === 'string' ? pkg.scripts.start : null,
      configPort: Number.isInteger(packagePort) && packagePort >= 1 && packagePort <= 65535 ? packagePort : null,
    },
    liaraJson,
    existingEntrypoints,
  };
}

export class RecoveryWorkflow {
  constructor({ projectRoot, replayLogs, replayReleases, provider = new MockDeploymentProvider(), healthVerifier, mockScenario = 'success', incidentScenario = 'startup-missing', codingAgent = new FakeCodingAgentAdapter() }) {
    this.projectRoot = projectRoot;
    this.replayLogs = replayLogs;
    this.replayReleases = replayReleases;
    this.provider = provider;
    this.healthVerifier = healthVerifier;
    this.mockScenario = mockScenario;
    this.incidentScenario = incidentScenario;
    this.codingAgent = codingAgent === 'PROCESS_FAKE_AGENT' ? new ProcessFakeCodingAgentAdapter()
      : codingAgent === 'FAKE_AGENT' ? new FakeCodingAgentAdapter() : codingAgent;
    this.runId = randomUUID();
    this.status = 'READY';
    this.approvals = new Set();
    this.repairUsed = false;
    this.repairInFlight = false;
    this.deployUsed = false;
    this.deployInFlight = false;
    this.inspectInFlight = false;
  }

  /** True while any operation holds the workflow; callers must not replace or clean up its workspace. */
  get busy() { return this.inspectInFlight || this.repairInFlight || this.deployInFlight; }

  #codingAgentLabel() {
    const mode = this.codingAgent.mode ?? 'FAKE_AGENT';
    if (mode === 'AUTHENTIC_AGENT_LOCAL') {
      return this.codingAgent.lastInvocation?.status === 'COMPLETED' && this.codingAgent.lastInvocation?.semanticValidation === 'PASSED'
        ? 'AUTHENTIC_AGENT_LOCAL' : 'AUTHENTIC_AGENT_PENDING';
    }
    return mode;
  }

  #requireIdle() {
    if (this.busy) throw new Error('BUSY: another operation is in progress; the request was not applied');
  }

  async inspect({ expectedGeneration = 1, operationId = randomUUID() } = {}) {
    this.#requireIdle();
    this.inspectInFlight = true;
    this.observation = null;
    this.approvals.clear();
    this.result = null;
    this.localHttpHealth = null;
    this.lastError = null;
    this.status = 'INSPECTING';
    try {
      return await this.#inspect({ expectedGeneration, operationId });
    } catch {
      this.observation = null;
      this.status = 'INSPECTION_FAILED';
      this.lastError = 'Inspection failed; previous diagnosis and approvals were cleared.';
      throw new Error('Inspection failed; previous diagnosis and approvals were cleared');
    } finally {
      this.inspectInFlight = false;
    }
  }

  async #inspect({ expectedGeneration, operationId }) {
    const findings = await inspectRepository(this.projectRoot);
    const pkgText = await this.#readPackage();
    const pkg = JSON.parse(pkgText);
    const start = pkg?.scripts?.start;
    const sourceSnapshot = await readRepairSnapshot(this.projectRoot, pkgText);
    const incident = classifyReplayIncident(this.replayLogs, this.replayReleases);
    const release = incident.release;
    const matchingLogs = this.replayLogs.source === 'REPLAY' && Array.isArray(this.replayLogs.lines)
      ? this.replayLogs.lines.filter(isEntryPointFailure)
      : [];
    const correlation = incident.correlation;
    const replacementExists = sourceSnapshot.existingEntrypoints.length > 0;
    const configuredEntrypoint = configuredStartupEntrypoint(start);
    const startupEvidenceMatches = incident.evidenceItems?.some(item => item.type === 'STARTUP_ENTRYPOINT_MISSING'
      && item.details?.missingEntrypoint === configuredEntrypoint);
    const startupFailure = incident.category === 'STARTUP_ENTRYPOINT_MISSING' && configuredEntrypoint !== null
      && startupEvidenceMatches
      && !sourceSnapshot.existingEntrypoints.includes(configuredEntrypoint)
      && matchingLogs.length > 0 && correlation === 'CONFIRMED' && release?.state === 'FAILED';
    const portEvidence = incident.evidenceItems?.find(item => item.type === 'PORT_CONFIGURATION_MISMATCH');
    const portFailure = incident.category === 'PORT_CONFIGURATION_MISMATCH' && correlation === 'CONFIRMED'
      && release?.state === 'FAILED' && findings.some(item => item.code === 'PORT_CONFIG_MISMATCH')
      && sourceSnapshot.packageJson.configPort === portEvidence?.details?.applicationPort
      && sourceSnapshot.liaraJson?.port === portEvidence?.details?.deploymentPort;
    const supportedFailure = startupFailure || portFailure;
    const failureType = startupFailure ? 'STARTUP_ENTRYPOINT_MISSING' : portFailure ? 'PORT_CONFIGURATION_MISMATCH' : null;
    const taskEvidence = failureType ? (incident.evidenceItems ?? []).filter(item => item.type === failureType).map(item => ({
      id: item.id,
      type: item.type,
      summary: item.type === 'STARTUP_ENTRYPOINT_MISSING'
        ? 'The selected failed release reports the configured startup entrypoint as missing.'
        : `The selected failed release records application port ${item.details.applicationPort} against declared deployment port ${item.details.deploymentPort}.`,
      details: item.details,
    })) : [];
    const stable = this.replayReleases.releases.find(item => item.current && item.state === 'READY') ?? null;
    let handoff = null;
    let repairProposal = null;
    let handoffStatus = 'NOT_SENT';
    let handoffError = null;
    if (supportedFailure) {
      try {
        handoff = createRepairTask({ runId: this.runId, expectedGeneration, operationId, selectedReleaseId: release.id,
          failureType, sanitizedEvidence: taskEvidence, sourceSnapshot, provenance: { source: 'REPLAY', releaseState: release.state } });
      } catch {
        handoff = null;
      }
      if (handoff) {
        handoffStatus = 'SENT';
        try {
          repairProposal = await this.codingAgent.proposeRepair(handoff);
          validateRepairProposal(handoff, repairProposal, this.codingAgent.mode ?? 'FAKE_AGENT');
          handoffStatus = 'COMPLETE';
        } catch {
          repairProposal = null;
          handoffError = 'Coding Agent handoff failed validation or transport; no repair is actionable.';
          handoffStatus = 'FAILED';
        }
      }
    }
    const validatedDiagnosis = Boolean(supportedFailure && handoff && repairProposal?.status === 'PROPOSED' && handoffStatus === 'COMPLETE');
    const manualActionRequired = correlation === 'CONFIRMED' && ['PORT_BIND_CONFLICT', 'REQUIRED_CONFIG_MISSING'].includes(incident.category);
    this.lastError = handoffError;
    this.observation = { pkgText, sourceSnapshot, start, findings, matchingLogs, incident, release, stable, rootCause: validatedDiagnosis, failureType,
      correlation, replacementExists, handoff, handoffStatus, handoffError, repairProposal, manualActionRequired };
    this.status = validatedDiagnosis ? 'DIAGNOSED'
      : repairProposal?.status === 'NO_SAFE_REPAIR' ? 'NO_SAFE_REPAIR'
      : handoffStatus === 'FAILED' ? 'HANDOFF_FAILED' : manualActionRequired ? 'UNSUPPORTED_REPAIR' : 'INSPECTED';
    return this.snapshot();
  }

  diagnosisEvidence() {
    const o = this.observation;
    if (!o?.rootCause || !o?.release?.id || this.replayLogs?.source !== 'REPLAY') return null;
    const signals = o.failureType === 'STARTUP_ENTRYPOINT_MISSING' ? ['MODULE_NOT_FOUND'] : ['PORT_CONFIGURATION_MISMATCH'];
    return {
      releaseId: o.release.id,
      releaseState: o.release.state ?? 'UNKNOWN',
      correlation: o.correlation,
      logs: (o.incident.evidenceItems ?? []).filter(item => item.type === o.failureType).map(item => ({
        releaseId: o.release.id, evidenceId: item.id, signals, releaseState: o.release.state ?? 'UNKNOWN',
        ...(item.details.missingEntrypoint ? { missingEntrypoint: item.details.missingEntrypoint } : {}),
        ...(item.details.applicationPort ? { applicationPort: item.details.applicationPort, deploymentPort: item.details.deploymentPort } : {}),
      })),
    };
  }

  snapshot() {
    const o = this.observation;
    if (!o) return {
      mode: 'REPLAY + MOCK', runId: this.runId, mockScenario: this.mockScenario, incidentScenario: this.incidentScenario, status: this.status,
      codingAgent: { source: this.#codingAgentLabel(), status: 'NOT_RUN', reason: null,
        provenance: this.codingAgent.lastInvocation ? { ...this.codingAgent.lastInvocation } : null,
        processId: this.codingAgent.lastChildPid ?? null, transportProof: this.codingAgent.lastChildPid ? 'SEPARATE_NODE_PROCESS' : null },
      diagnosis: null, evidence: null, repair: null, handoff: null, timeline: this.#timeline(), deployDigest: null,
      error: this.lastError ?? null,
      localHttpHealth: { source: 'LOCAL_HTTP', status: 'NOT_RUN' },
      approval: { repair: 'REQUIRED', deploy: 'REQUIRED' }, result: null,
    };
    return {
      mode: 'REPLAY + MOCK', runId: this.runId, mockScenario: this.mockScenario, incidentScenario: this.incidentScenario, status: this.status,
      handoff: { source: 'REPLAY', status: o.handoffStatus === 'COMPLETE' ? 'HANDED_OFF' : o.handoffStatus ?? (o.handoff ? 'HANDED_OFF' : 'NOT_SENT'), request: o.handoff },
      codingAgent: { source: this.#codingAgentLabel(), status: o.repairProposal?.status ?? (o.handoffStatus === 'FAILED' ? 'FAILED' : 'NOT_RUN'), reason: o.handoffError,
        provenance: this.codingAgent.lastInvocation ? { ...this.codingAgent.lastInvocation } : null,
        processId: this.codingAgent.lastChildPid ?? null, transportProof: this.codingAgent.lastChildPid ? 'SEPARATE_NODE_PROCESS' : null },
      timeline: this.#timeline(o),
      error: this.lastError ?? o.handoffError ?? null,
      diagnosis: o.rootCause && o.failureType === 'STARTUP_ENTRYPOINT_MISSING' ? {
        title: 'دستور شروع به فایل ناموجود اشاره می‌کند',
        detail: `scripts.start برابر «${o.start}» است؛ انتشار ناموفق به فایل موجودی برای راه‌اندازی اشاره نمی‌کند.`,
        confidence: 'بالا؛ تطبیق مقدار پیکربندی، ورودی موجود و انتشار ناموفق بازپخش‌شده',
        correlation: o.correlation, code: o.incident.code, recommendation: 'BOUNDED_FIX_AVAILABLE', repairDisposition: 'SUPPORTED_FIX',
      } : o.rootCause && o.failureType === 'PORT_CONFIGURATION_MISMATCH' ? {
        title: 'پورت برنامه با قرارداد انتشار تفاوت دارد',
        detail: `package.json config.port برابر ${o.sourceSnapshot.packageJson.configPort} است؛ liara.json پورت ${o.sourceSnapshot.liaraJson.port} را اعلام می‌کند.`,
        confidence: 'بالا؛ مقدار دو طرف قرارداد و شاهد همان انتشار با یکدیگر تطبیق دارند',
        correlation: o.correlation, code: o.incident.code, recommendation: 'BOUNDED_FIX_AVAILABLE', repairDisposition: 'SUPPORTED_FIX',
      } : o.manualActionRequired ? {
        title: o.incident.category === 'PORT_BIND_CONFLICT' ? 'تعارض در اتصال پورت' : 'تنظیم لازم در شواهد موجود نیست',
        detail: o.incident.category === 'PORT_BIND_CONFLICT'
          ? 'انتشار ناموفق خطای EADDRINUSE را برای پورت آزمایشی 3000 گزارش کرده است. اپراتور باید تنظیم پورت و مالکیت listener را بررسی کند؛ هیچ فرایندی متوقف یا دوباره راه‌اندازی نمی‌شود.'
          : 'شواهد مصنوعی می‌گوید APP_PUBLIC_ORIGIN تنظیم نشده است. مقدار را از مسیر مجاز پروژه بررسی کنید؛ این دمو متغیرهای محیطی را نمی‌خواند یا تغییر نمی‌دهد.',
        confidence: 'بالا؛ شواهد REPLAY به انتشار ناموفق انتخاب‌شده متصل است', correlation: o.correlation,
        code: o.incident.code, recommendation: 'MANUAL_ACTION_REQUIRED', repairDisposition: 'UNSUPPORTED_REPAIR',
      } : { title: o.repairProposal?.status === 'NO_SAFE_REPAIR' ? 'اصلاح امنی پیدا نشد' : 'شرایط تشخیص قطعی فراهم نیست', detail: o.repairProposal?.status === 'NO_SAFE_REPAIR'
        ? o.repairProposal.explanation : o.incident.code === 'AMBIGUOUS_EVIDENCE'
        ? 'شواهد خطا مبهم، متعارض، نامعتبر یا به انتشار انتخاب‌شده منتسب نیست؛ هیچ اصلاحی پیشنهاد نمی‌شود.'
        : o.correlation === 'CONFIRMED'
        ? 'انتساب لاگ به انتشار تطبیق دارد، اما سیگنال دقیق خطای ورودی یا فایل جایگزین محدود و معتبر تأیید نشد؛ اصلاحی پیشنهاد نمی‌شود.'
        : 'علت قطعی اعلام نمی‌شود؛ سیگنال دقیق خطای ورودی یا انتساب لاگ به انتشار تأیید نشد.', confidence: 'نامشخص', correlation: o.correlation,
        code: o.incident.code, recommendation: o.repairProposal?.status === 'NO_SAFE_REPAIR' ? 'NO_SAFE_REPAIR' : 'NO_AUTOMATIC_ACTION', repairDisposition: 'UNSUPPORTED_REPAIR' },
      evidence: {
        findings: o.findings,
        logs: o.incident.logs,
        failedRelease: o.release, priorHealthyRelease: o.stable,
      },
      repair: o.rootCause ? { file: o.repairProposal.changes[0].path, field: o.repairProposal.changes[0].field,
        before: o.repairProposal.changes[0].expectedOldContent, after: o.repairProposal.changes[0].replacementContent,
        digest: this.repairDigest ?? this.#repairDigest(o.pkgText), proposal: o.repairProposal } : null,
      deployDigest: this.#deployDigest(),
      localHttpHealth: this.localHttpHealth ?? { source: 'LOCAL_HTTP', status: 'NOT_RUN' },
      approval: { repair: this.repairUsed ? 'USED' : this.approvals.has(this.#repairDigest(o.pkgText)) ? 'APPROVED' : 'REQUIRED', deploy: this.deployUsed ? 'USED' : this.approvals.has(this.#deployDigest()) ? 'APPROVED' : 'REQUIRED' },
      result: this.result ?? null,
    };
  }

  approveRepair(digest) {
    this.#requireIdle();
    this.#requireDiagnosis();
    if (!this.#currentEvidenceMatches()) {
      this.#invalidateRepair('Evidence changed after diagnosis; inspect again.');
      throw new Error('Evidence changed after diagnosis; inspect again');
    }
    const current = this.#repairDigest(this.observation.pkgText);
    if (digest !== current || this.repairUsed) throw new Error('Repair approval is invalid, stale, or already used');
    this.approvals.add(current);
    this.status = 'AWAITING_REPAIR';
    return this.snapshot();
  }

  denyRepair() {
    this.#requireIdle();
    if (this.status !== 'DIAGNOSED' && this.status !== 'AWAITING_REPAIR') throw new Error('No repair is awaiting a decision');
    if (this.observation) this.approvals.delete(this.#repairDigest(this.observation.pkgText));
    this.status = 'REPAIR_DECLINED';
    return this.snapshot();
  }

  async applyRepair(digest) {
    this.#requireIdle();
    this.#requireDiagnosis();
    const approved = this.#repairDigest(this.observation.pkgText);
    if (digest !== approved || !this.approvals.has(approved) || this.repairUsed || this.repairInFlight) throw new Error('Explicit one-use repair approval required');
    this.repairInFlight = true;
    this.status = 'APPLYING_REPAIR';
    try {
    const current = await this.#readPackage();
    const proposal = this.observation.repairProposal;
    validateRepairProposal(this.observation.handoff, proposal, this.codingAgent.mode ?? 'FAKE_AGENT');
    const currentSnapshot = await readRepairSnapshot(this.projectRoot, current);
    if (digestSourceSnapshot(currentSnapshot) !== proposal.sourceSnapshotDigest) throw new Error('Source snapshot changed after approval; inspect again');
    const change = proposal.changes[0];
    if (!this.#currentEvidenceMatches()) throw new Error('Evidence changed after approval; repair blocked');
    if (sha(current) !== sha(this.observation.pkgText)) throw new Error('package.json changed after approval; inspect again');
    const parsed = JSON.parse(current);
    if (change.path !== REPAIR_PATH || change.operation !== 'REPLACE_JSON_FIELD') throw new Error('Repair target is outside the approved scope');
    if (change.field === 'scripts.start') {
      if (parsed?.scripts?.start !== change.expectedOldContent) throw new Error('Repair target no longer matches the approved proposal');
      parsed.scripts.start = change.replacementContent;
    } else if (change.field === 'config.port') {
      if (parsed?.config?.port !== change.expectedOldContent || !Number.isInteger(change.replacementContent)) throw new Error('Repair target no longer matches the approved proposal');
      parsed.config.port = change.replacementContent;
    } else throw new Error('Repair field is outside the approved scope');
    const updated = `${JSON.stringify(parsed, null, 2)}\n`;
    const target = join(this.projectRoot, REPAIR_PATH);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new Error('Repair target is not a bounded regular file');
    const temp = `${target}.liara-${process.pid}.tmp`;
    try {
      await writeFile(temp, updated, { flag: 'wx', mode: info.mode });
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
    this.repairUsed = true;
    this.repairDigest = approved;
    this.status = 'REINSPECTING';
    const findings = await inspectRepository(this.projectRoot);
    const after = await this.#readPackage();
    const afterPkg = JSON.parse(after);
    const repairedValue = change.field === 'scripts.start' ? afterPkg?.scripts?.start : afterPkg?.config?.port;
    if (repairedValue !== change.replacementContent) throw new Error('Reinspection did not confirm the approved repair');
    this.observation.pkgText = after;
    this.observation.findings = findings;
    try {
      this.localHttpHealth = this.healthVerifier
        ? await this.healthVerifier(this.projectRoot)
        : { source: 'LOCAL_HTTP', status: 'UNKNOWN', reason: 'Local health verifier is not configured.' };
    } catch {
      this.localHttpHealth = { source: 'LOCAL_HTTP', status: 'UNKNOWN', reason: 'Local health verification failed unexpectedly.' };
    }
    this.status = findings.length === 0 && this.localHttpHealth.status === 'VERIFIED' ? 'REPAIRED'
      : this.localHttpHealth.status === 'FAILED' ? 'LOCAL_HEALTH_FAILED' : 'LOCAL_HEALTH_UNKNOWN';
    return this.snapshot();
    } catch (error) {
      if (this.repairUsed) {
        this.approvals.clear();
        this.observation = { ...this.observation, rootCause: false, repairProposal: null, handoffStatus: 'FAILED', handoffError: 'Repair was applied but post-repair verification is uncertain.' };
        this.status = 'UNKNOWN';
      } else {
        this.#invalidateRepair('Approved repair preconditions changed or the repair could not be verified; inspect again.');
      }
      throw error;
    } finally {
      this.repairInFlight = false;
    }
  }

  approveDeploy(digest) {
    this.#requireIdle();
    if (this.status !== 'REPAIRED' || this.localHttpHealth?.status !== 'VERIFIED') throw new Error('A verified local HTTP health check is required before deployment approval');
    const expected = this.#deployDigest();
    if (digest !== expected || this.deployUsed) throw new Error('Deployment approval is invalid, stale, or already used');
    this.approvals.add(expected);
    this.status = 'AWAITING_DEPLOY';
    return this.snapshot();
  }

  denyDeploy() {
    // Once deploy() has claimed the approval, a denial can no longer revoke it; refuse rather than accept a denial that is not honoured.
    this.#requireIdle();
    if (this.status !== 'REPAIRED' && this.status !== 'AWAITING_DEPLOY') throw new Error('No deployment is awaiting a decision');
    this.approvals.delete(this.#deployDigest());
    this.status = 'DEPLOY_DECLINED';
    return this.snapshot();
  }

  async deploy(digest) {
    this.#requireIdle();
    if (this.status !== 'AWAITING_DEPLOY') throw new Error('Separate deployment approval required');
    const expected = this.#deployDigest();
    if (digest !== expected || !this.approvals.has(expected) || this.deployUsed || this.deployInFlight) throw new Error('Explicit deployment approval required');
    // Claimed synchronously: the awaited read below must not let a concurrent request reach the provider write.
    this.deployInFlight = true;
    try {
      return await this.#executeApprovedDeploy();
    } finally {
      this.deployInFlight = false;
    }
  }

  async #executeApprovedDeploy() {
    const contentDigest = sha(this.observation.pkgText);
    const current = await this.#readPackage();
    if (sha(current) !== contentDigest) throw new Error('Approved content changed; deployment blocked');
    // Defence in depth: the approval must still stand immediately before the one-use claim and provider write.
    if (this.status !== 'AWAITING_DEPLOY' || !this.approvals.has(this.#deployDigest())) throw new Error('Deployment approval is no longer valid; deployment blocked');
    this.deployUsed = true;
    this.status = 'DEPLOYING';
    const plan = { action: 'deploy', app: 'liara-recovery-demo', version: 'recovery-v2', contentDigest };
    let candidate;
    try {
      candidate = this.provider.deploy(plan, planDigest(plan));
    } catch {
      this.status = 'UNKNOWN';
      this.result = { outcome: 'UNKNOWN', reason: 'Mock deployment outcome is ambiguous; no retry was attempted.', candidate: null };
      return this.snapshot();
    }
    this.status = 'VERIFYING';
    let verification;
    try {
      verification = this.provider.verifyCandidate(candidate, plan.version);
    } catch {
      verification = null;
    }
    if (!verification) {
      this.status = 'UNKNOWN';
      this.result = { outcome: 'UNKNOWN', reason: 'Candidate verification was unavailable.', candidate };
    } else if (verification.ok) {
      this.status = 'SUCCESS';
      this.result = { outcome: 'SUCCESS', candidate, verification, evidence: 'MOCK candidate identity, version, READY state, and current state matched.' };
    } else {
      this.status = 'FAILED';
      this.result = { outcome: 'FAILED', candidate, verification, evidence: 'The candidate did not satisfy identity, version, READY, and current checks. A healthy prior release cannot prove candidate success.' };
    }
    return this.snapshot();
  }

  #requireDiagnosis() { if (this.status !== 'DIAGNOSED' && this.status !== 'AWAITING_REPAIR') throw new Error('Diagnosis is required'); }
  #invalidateRepair(reason) {
    this.approvals.clear();
    if (this.observation) this.observation = { ...this.observation, rootCause: false, repairProposal: null, handoffStatus: 'FAILED', handoffError: reason };
    this.lastError = reason;
    this.status = 'REPAIR_BLOCKED';
  }
  #currentEvidenceMatches() {
    const observation = this.observation;
    const release = this.replayReleases?.releases?.find(item => item.id === this.replayLogs?.releaseId);
    const current = classifyReplayIncident(this.replayLogs, this.replayReleases);
    const currentIds = (current.evidenceItems ?? []).filter(item => item.type === observation?.failureType).map(item => item.id);
    return Boolean(observation?.handoff && release && release.state === 'FAILED'
      && current.correlation === 'CONFIRMED' && current.category === observation.failureType
      && release.id === observation.handoff.selectedReleaseId
      && currentIds.length === observation.handoff.sanitizedEvidenceIds.length
      && currentIds.every((id, index) => id === observation.handoff.sanitizedEvidenceIds[index]));
  }
  #timeline(o = this.observation) {
    const hasFailure = Boolean(o?.handoff && o.handoffStatus !== 'FAILED');
    const hasProposal = Boolean(o?.repairProposal);
    const repaired = ['REPAIRED', 'AWAITING_DEPLOY', 'DEPLOYING', 'VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN'].includes(this.status);
    const repairApproved = this.approvals?.has(this.#repairDigest(o?.pkgText ?? '')) || this.repairUsed;
    const deployApproved = this.approvals?.has(this.#deployDigest()) || this.deployUsed;
    return [
      { stage: 'EVIDENCE', source: 'REPLAY', status: o ? 'COMPLETE' : 'PENDING' },
      { stage: 'DETERMINISTIC_DIAGNOSIS', source: 'REPLAY', status: o?.incident?.correlation === 'CONFIRMED' && o.incident.category ? 'CONFIRMED' : o ? 'NO_REPAIR' : 'PENDING' },
      { stage: 'CODING_AGENT_HANDOFF', source: this.#codingAgentLabel(), status: o?.handoffStatus === 'FAILED' ? 'FAILED' : hasFailure ? (this.codingAgent.lastChildPid ? `COMPLETE · worker PID ${this.codingAgent.lastChildPid}` : 'COMPLETE') : o ? 'SKIPPED' : 'PENDING' },
      { stage: 'REPAIR_PROPOSAL', source: this.#codingAgentLabel(), status: o?.repairProposal?.status === 'NO_SAFE_REPAIR' ? 'NO_SAFE_REPAIR' : hasProposal ? 'COMPLETE' : o?.handoffStatus === 'FAILED' ? 'BLOCKED' : o ? 'SKIPPED' : 'PENDING' },
      { stage: 'REPAIR_APPROVAL', source: 'SIMULATED_USER_INPUT', status: repairApproved ? (this.repairUsed ? 'CONSUMED' : 'APPROVED') : hasProposal ? 'REQUIRED' : 'BLOCKED' },
      { stage: 'LOCAL_REPAIR', source: 'TEMP_FIXTURE', status: this.repairUsed ? 'COMPLETE' : 'PENDING' },
      { stage: 'HEALTH_CHECK', source: 'LOCAL_HTTP', status: this.localHttpHealth?.status ?? 'PENDING' },
      { stage: 'MOCK_DEPLOY_APPROVAL', source: 'SIMULATED_USER_INPUT', status: deployApproved ? (this.deployUsed ? 'CONSUMED' : 'APPROVED') : repaired ? 'REQUIRED' : 'BLOCKED' },
      { stage: 'MOCK_DEPLOY', source: 'MOCK', status: this.deployUsed ? (this.status === 'UNKNOWN' ? 'UNKNOWN' : 'COMPLETE') : 'PENDING' },
      { stage: 'CANDIDATE_VERIFICATION', source: 'MOCK', status: this.result?.verification ? (this.result.verification.ok ? 'VERIFIED' : 'FAILED') : this.status === 'UNKNOWN' && this.deployUsed ? 'UNKNOWN' : 'PENDING' },
    ];
  }
  #repairDigest(content) {
    const proposal = this.observation?.repairProposal;
    if (!proposal) return sha(JSON.stringify({ action: 'apply-repair', target: 'liara-recovery-demo/package.json', beforeContent: sha(content), before: BROKEN_COMMAND, after: FIXED_COMMAND }));
    return sha(JSON.stringify({ action: 'apply-repair', target: 'trusted-fixture/package.json', beforeContent: sha(content), runId: proposal.runId,
      requestId: proposal.requestId, operationId: proposal.operationId, expectedGeneration: proposal.expectedGeneration,
      selectedReleaseId: proposal.selectedReleaseId, evidenceIds: proposal.evidenceIds,
      sourceSnapshotDigest: proposal.sourceSnapshotDigest, changes: proposal.changes }));
  }
  #deployDigest() {
    return sha(JSON.stringify({ action: 'deploy', app: 'liara-recovery-demo', version: 'recovery-v2', contentDigest: sha(this.observation?.pkgText ?? '') }));
  }
  async #readPackage() {
    const target = join(this.projectRoot, REPAIR_PATH);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new Error('package.json must be a bounded regular file');
    return readFile(target, 'utf8');
  }
}
