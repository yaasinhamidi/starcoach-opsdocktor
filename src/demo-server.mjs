import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { RecoveryWorkflow } from './recovery.mjs';
import { recoveryHtml } from './recovery-ui.mjs';
import { MockDeploymentProvider } from './mock-provider.mjs';
import { createTrustedRecoveryWorkspace, verifyTrustedLocalHealth } from './local-health.mjs';
import { createDiagnosisProviderFromEnv, diagnoseWithFallback, makeDiagnosisEvidence } from './diagnosis-providers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const evidenceRoot = join(repoRoot, 'fixtures', 'recovery-evidence');
const fontAsset = join(repoRoot, 'assets', 'fonts', 'Vazirmatn-Variable.woff2');
const scenarios = new Set(['success', 'failed', 'not-current', 'unknown']);
const codingAgentModes = new Set(['FAKE_AGENT', 'PROCESS_FAKE_AGENT']);
const incidentScenarios = new Map([
  ['startup-missing', ['logs.json', 'releases.json']],
  ['port-conflict', ['port-conflict-logs.json', 'port-conflict-releases.json']],
  ['port-config-mismatch', ['port-config-mismatch-logs.json', 'port-config-mismatch-releases.json']],
  ['missing-config', ['missing-config-logs.json', 'missing-config-releases.json']],
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTATIONS = new Map([
  ['/api/reset', ['scenario', 'codingAgentMode', 'incidentScenario']],
  ['/api/inspect', []], ['/api/approve-repair', ['digest']], ['/api/deny-repair', []],
  ['/api/apply-repair', ['digest']], ['/api/approve-deploy', ['digest']], ['/api/deny-deploy', []], ['/api/deploy', ['digest']],
  ['/api/diagnose', []], ['/api/live-diagnosis', []],
]);
const MAX_OPERATIONS = 4096;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

class MutationError extends Error {
  constructor(code, status = 409, message = code) { super(message); this.code = code; this.status = status; }
}

async function readFixture(name) {
  return JSON.parse(await readFile(join(evidenceRoot, name), 'utf8'));
}

function providerFor(scenario) {
  if (scenario === 'success') return new MockDeploymentProvider();
  if (scenario === 'failed') return new MockDeploymentProvider({ candidateState: 'FAILED' });
  if (scenario === 'not-current') return new MockDeploymentProvider({ activateCandidate: false });
  if (scenario === 'unknown') {
    const inner = new MockDeploymentProvider();
    return {
      deploy(plan, approval) { inner.deploy(plan, approval); throw new Error('simulated timeout after request'); },
      verifyCandidate: (...args) => inner.verifyCandidate(...args),
    };
  }
  throw new TypeError('Unsupported mock scenario');
}

const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

/** Blocks DNS-rebinding and cross-site requests: approvals must come from this page on a loopback origin. */
function localRequestRejection(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !LOCAL_HOST.test(host)) return 'Only loopback Host headers are accepted';
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return 'Cross-origin requests are not accepted';
  const hasBody = req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] ?? '0') !== '0';
  if (req.method === 'POST' && hasBody
    && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return 'POST bodies must be application/json';
  return null;
}

async function createSession(scenario = 'success', codingAgentMode = 'FAKE_AGENT', incidentScenario = 'startup-missing') {
  if (!scenarios.has(scenario)) throw new TypeError('Unsupported mock scenario');
  if (!codingAgentModes.has(codingAgentMode)) throw new TypeError('Unsupported Coding Agent mode');
  const incidentFixtures = incidentScenarios.get(incidentScenario);
  if (!incidentFixtures) throw new TypeError('Unsupported incident scenario');
  const workspace = await createTrustedRecoveryWorkspace({ incidentScenario: incidentScenario === 'port-config-mismatch' ? 'port-config-mismatch' : 'startup-missing' });
  const workflow = new RecoveryWorkflow({
    projectRoot: workspace.appRoot,
    replayLogs: await readFixture(incidentFixtures[0]),
    replayReleases: await readFixture(incidentFixtures[1]),
    provider: providerFor(scenario),
    healthVerifier: verifyTrustedLocalHealth,
    mockScenario: scenario,
    incidentScenario,
    codingAgent: codingAgentMode,
  });
  return { workflow, cleanup: workspace.cleanup };
}

export async function createDemoServer({ provider, diagnosisProvider = createDiagnosisProviderFromEnv(), workflow, scenario = 'success', incidentScenario = 'startup-missing', codingAgentMode = 'FAKE_AGENT', liveReadOnlyAuthorized = false, readOnlyAdapter, liveProjectName, liveReleaseTag, liveSince, liveUntil, sessionFactory = createSession } = {}) {
  let session = workflow
    ? { workflow, cleanup: async () => {} }
    : await sessionFactory(scenario, codingAgentMode, incidentScenario);
  const serverInstanceId = randomUUID();
  let generation = 1;
  let resetInFlight = false;
  const operations = new Map();
  const unresolvedDeployments = [];
  const authoritativeState = (generationValue = generation) => ({
    serverInstanceId,
    generation: generationValue,
    unresolvedDeployments: unresolvedDeployments.map(item => ({ ...item })),
  });
  const snapshot = (workflowValue = session.workflow, generationValue = generation) => ({
    ...workflowValue.snapshot(), ...authoritativeState(generationValue),
  });
  const reserveMutation = (path, body) => {
    const payloadKeys = MUTATIONS.get(path);
    if (!payloadKeys) throw new MutationError('UNKNOWN_OPERATION', 404);
    if (!exactKeys(body, ['serverInstanceId', 'expectedRunId', 'expectedGeneration', 'operationId', 'payload'])
      || !exactKeys(body.payload, payloadKeys)) throw new MutationError('INVALID_ENVELOPE', 400);
    if (!UUID.test(body.serverInstanceId) || !UUID.test(body.expectedRunId) || !UUID.test(body.operationId)
      || !Number.isSafeInteger(body.expectedGeneration) || body.expectedGeneration < 1) throw new MutationError('INVALID_ENVELOPE', 400);
    if (body.serverInstanceId !== serverInstanceId) throw new MutationError('STALE_SERVER_INSTANCE');
    if (body.expectedRunId !== session.workflow.runId) throw new MutationError('STALE_RUN');
    if (body.expectedGeneration !== generation) throw new MutationError('STALE_GENERATION');
    const fingerprint = createHash('sha256').update(canonical([path, body.serverInstanceId, body.expectedRunId, body.expectedGeneration, body.payload])).digest('hex');
    const previous = operations.get(body.operationId);
    if (previous) throw new MutationError(previous.fingerprint === fingerprint ? 'DUPLICATE_OPERATION' : 'OPERATION_CONFLICT');
    if (operations.size >= MAX_OPERATIONS) throw new MutationError('OPERATION_REGISTRY_FULL');
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const record = { id: body.operationId, fingerprint, status: 'RUNNING', path, done, finish };
    operations.set(record.id, record);
    return { record, payload: body.payload, expectedRunId: body.expectedRunId, expectedGeneration: body.expectedGeneration };
  };
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const collectLiveEvidence = async () => {
    if (liveReadOnlyAuthorized !== true || !readOnlyAdapter || !liveProjectName || !liveReleaseTag || liveSince === undefined || liveUntil === undefined) {
      return { mode: 'UNAVAILABLE', status: 'UNAVAILABLE', reason: 'LIVE READ-ONLY is disabled pending explicit owner authorization and scoped local configuration.', sourceToReleaseCorrespondence: 'UNCONFIRMED' };
    }
    try {
      const project = await readOnlyAdapter.getProject(liveProjectName);
      if (project.status !== 'AVAILABLE') return { mode: project.status === 'UNKNOWN' ? 'UNKNOWN' : 'UNAVAILABLE', status: project.status, project: null, releases: null, logEvidence: { status: project.status, releaseLogAttribution: 'UNCONFIRMED', startupFailureIdentification: { status: 'UNCONFIRMED', code: null, entrypoint: null }, logs: [], signals: [] }, sourceToReleaseCorrespondence: 'UNCONFIRMED' };
      const releases = await readOnlyAdapter.getReleases(liveProjectName);
      const logs = releases.status === 'AVAILABLE'
        ? await readOnlyAdapter.getReleaseLogs(liveProjectName, { releaseTag: liveReleaseTag, since: liveSince, until: liveUntil, releases: releases.data })
        : { status: releases.status, correlation: 'UNCONFIRMED', logs: [], signals: [], startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null } };
      const statuses = [project.status, releases.status, logs.status];
      const status = statuses.includes('UNKNOWN') ? 'UNKNOWN' : statuses.every(value => value === 'AVAILABLE') ? 'AVAILABLE' : 'UNAVAILABLE';
      return {
        mode: status === 'AVAILABLE' ? 'LIVE READ-ONLY' : status, status,
        project: project.data, releases: releases.data,
        logEvidence: { status: logs.status, release: logs.release, timeRange: { since: liveSince, until: liveUntil }, releaseLogAttribution: logs.releaseLogAttribution ?? logs.correlation ?? 'UNCONFIRMED', startupFailureIdentification: logs.startupFailure ?? { status: 'UNCONFIRMED', code: null, entrypoint: null }, logs: logs.logs ?? [], signals: logs.signals ?? [] },
        sourceToReleaseCorrespondence: 'UNCONFIRMED', note: 'Liara release evidence is not bound to the local source snapshot.',
      };
    } catch {
      return { mode: 'UNKNOWN', status: 'UNKNOWN', reason: 'Sanitized read-only evidence could not be retrieved.', sourceToReleaseCorrespondence: 'UNCONFIRMED' };
    }
  };
  const server = createServer(async (req, res) => {
    try {
      const rejection = localRequestRejection(req);
      if (rejection) return send(res, 403, { error: rejection });
      if (req.method === 'GET' && req.url === '/')return send(res, 200, recoveryHtml, 'text/html; charset=utf-8');
      if (req.method === 'GET' && req.url === '/assets/fonts/Vazirmatn-Variable.woff2') {
        const font = await readFile(fontAsset);
        res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': font.byteLength, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        return res.end(font);
      }
      if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, snapshot());
      if (req.method === 'GET' && req.url === '/api/llm-status') return send(res, 200, diagnosisProvider.status());
      if (req.method === 'GET' && req.url === '/api/evidence') {
        const state = snapshot();
        const liveConfigured = liveReadOnlyAuthorized === true && Boolean(readOnlyAdapter);
        return send(res, 200, { mode: 'REPLAY', source: 'REPLAY',
          liveMode: liveConfigured ? 'ENABLED_ON_REQUEST' : 'DISABLED',
          liveReason: liveConfigured ? 'Owner-authorized GET-only evidence is read only when requested through the live evidence control.' : 'Owner authorization is not configured; no credential is read or sent.',
          evidence: state.evidence ?? null });
      }
      if (req.method === 'GET' && req.url === '/api/live-evidence') {
        return send(res, 200, await collectLiveEvidence());
      }
      if (req.method !== 'POST' || !req.url?.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 16_384) return send(res, 413, { error: 'Request too large', ...authoritativeState(), runId: session.workflow.runId });
      }
      const body = raw ? JSON.parse(raw) : {};
      const mutation = reserveMutation(req.url, body);
      const { record, payload, expectedGeneration } = mutation;
      const ownedSession = session;
      const ownedGeneration = generation;
      try {
      if (resetInFlight) throw new MutationError('BUSY');
      if (req.url === '/api/reset') {
        if (session.workflow.busy || [...operations.values()].some(item => item !== record && item.status === 'RUNNING')) throw new MutationError('BUSY');
        const { scenario: nextScenario, codingAgentMode: nextCodingAgentMode, incidentScenario: nextIncidentScenario } = payload;
        if (!scenarios.has(nextScenario) || !codingAgentModes.has(nextCodingAgentMode) || !incidentScenarios.has(nextIncidentScenario)) throw new MutationError('INVALID_PAYLOAD', 400);
        resetInFlight = true;
        let next;
        try {
          next = await sessionFactory(nextScenario, nextCodingAgentMode, nextIncidentScenario);
          if (session !== ownedSession || generation !== ownedGeneration) {
            await next.cleanup();
            throw new MutationError('STALE_RUN');
          }
          const previous = session;
          // Reset linearizes here: replacement and generation advance occur without an await.
          const previousState = previous.workflow.snapshot();
          if (previousState.status === 'UNKNOWN' && previousState.result?.outcome === 'UNKNOWN'
            && !unresolvedDeployments.some(item => item.runId === previous.workflow.runId)) {
            unresolvedDeployments.push({ runId: previous.workflow.runId, generation, operationId: record.id,
              outcome: 'UNKNOWN', source: 'MOCK', reason: 'A prior dispatch may have occurred; reconcile before another deployment.' });
          }
          session = next;
          generation += 1;
          await previous.cleanup();
          record.status = 'COMPLETE'; record.finish();
          return send(res, 200, { ...snapshot(), operationId: record.id });
        } finally { resetInFlight = false; }
      }
      if (['/api/approve-repair', '/api/apply-repair', '/api/approve-deploy', '/api/deploy'].includes(req.url)
        && (typeof payload.digest !== 'string' || !/^[a-f0-9]{64}$/.test(payload.digest))) throw new MutationError('INVALID_PAYLOAD', 400);
      if (req.url === '/api/diagnose') {
        const normalized = session.workflow.diagnosisEvidence();
        if (!normalized || normalized.correlation !== 'CONFIRMED' || normalized.releaseState !== 'FAILED') {
          throw new MutationError('ACTION_REJECTED');
        }
        const evidence = makeDiagnosisEvidence({ source: 'REPLAY', expectedReleaseId: normalized.releaseId, releaseState: normalized.releaseState, logs: normalized.logs });
        let result;
        try { result = await diagnoseWithFallback(diagnosisProvider, evidence); }
        catch { throw new MutationError('DIAGNOSIS_PROVIDER_FAILED'); }
        if (session !== ownedSession || generation !== ownedGeneration) throw new MutationError('STALE_RUN');
        record.status = 'COMPLETE'; record.finish();
        return send(res, 200, { inputMode: 'REPLAY', sourceToReleaseCorrespondence: 'UNCONFIRMED', ...result,
          ...authoritativeState(), runId: ownedSession.workflow.runId, operationId: record.id });
      } else if (req.url === '/api/live-diagnosis') {
        const live = await collectLiveEvidence();
        if (live.status !== 'AVAILABLE' || live.mode !== 'LIVE READ-ONLY') throw new MutationError('LIVE_EVIDENCE_UNAVAILABLE');
        if (live.logEvidence?.releaseLogAttribution !== 'CONFIRMED' || !live.logEvidence?.release?.id) throw new MutationError('LIVE_EVIDENCE_UNCORRELATED');
        const expectedRelease = live.releases?.releases?.find(release => release.id === live.logEvidence.release.id);
        const evidence = makeDiagnosisEvidence({ source: 'LIVE_READ_ONLY', expectedReleaseId: live.logEvidence.release.id, releaseState: expectedRelease?.state, logs: live.logEvidence.logs ?? [] });
        let result;
        try { result = await diagnoseWithFallback(diagnosisProvider, evidence); }
        catch { throw new MutationError('DIAGNOSIS_PROVIDER_FAILED'); }
        if (session !== ownedSession || generation !== ownedGeneration) throw new MutationError('STALE_RUN');
        record.status = 'COMPLETE'; record.finish();
        return send(res, 200, { inputMode: 'LIVE_READ_ONLY', inputStatus: 'AVAILABLE', sourceToReleaseCorrespondence: live.sourceToReleaseCorrespondence,
          ...result, ...authoritativeState(), runId: ownedSession.workflow.runId, operationId: record.id });
      }
      let result;
      if (req.url === '/api/inspect') result = await session.workflow.inspect({ expectedGeneration, operationId: record.id });
      else if (req.url === '/api/approve-repair') result = session.workflow.approveRepair(payload.digest);
      else if (req.url === '/api/deny-repair') result = session.workflow.denyRepair();
      else if (req.url === '/api/apply-repair') result = await session.workflow.applyRepair(payload.digest);
      else if (req.url === '/api/approve-deploy') {
        if (unresolvedDeployments.length) throw new MutationError('UNKNOWN_REQUIRES_RECONCILIATION');
        result = session.workflow.approveDeploy(payload.digest);
      }
      else if (req.url === '/api/deny-deploy') result = session.workflow.denyDeploy();
      else if (req.url === '/api/deploy') {
        if (unresolvedDeployments.length) throw new MutationError('UNKNOWN_REQUIRES_RECONCILIATION');
        result = await session.workflow.deploy(payload.digest);
        if (result.status === 'UNKNOWN' && result.result?.outcome === 'UNKNOWN') {
          unresolvedDeployments.push({ runId: session.workflow.runId, generation, operationId: record.id,
            outcome: 'UNKNOWN', source: 'MOCK', reason: 'A prior dispatch may have occurred; reconcile before another deployment.' });
        }
      }
      else throw new MutationError('UNKNOWN_OPERATION', 404);
      if (session !== ownedSession || generation !== ownedGeneration) throw new MutationError('STALE_RUN');
      record.status = 'COMPLETE'; record.finish();
      return send(res, 200, { ...result, ...authoritativeState(), operationId: record.id });
      } catch (error) {
        record.status = 'FAILED'; record.finish();
        throw error;
      }
    } catch (error) {
      if (error instanceof SyntaxError) return send(res, 400, { error: 'INVALID_JSON', message: 'Invalid JSON',
        ...authoritativeState(), runId: session.workflow.runId });
      const status = error instanceof MutationError ? error.status : /BUSY/.test(error?.message ?? '') ? 409 : 409;
      const code = error instanceof MutationError ? error.code : /BUSY/.test(error?.message ?? '') ? 'BUSY' : 'ACTION_REJECTED';
      return send(res, status, { error: code, message: error instanceof MutationError ? error.message : code,
        ...authoritativeState(), runId: session.workflow.runId });
    }
  });
  server.once('close', async () => {
    await Promise.all([...operations.values()].filter(record => record.status === 'RUNNING').map(record => record.done));
    await session.cleanup();
  });
  return { server, get workflow() { return session.workflow; } };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const codingAgentMode = process.argv.includes('--process-fake-agent') ? 'PROCESS_FAKE_AGENT' : 'FAKE_AGENT';
  const incidentArg = process.argv.find(arg => arg.startsWith('--incident='));
  const incidentScenario = incidentArg ? incidentArg.slice('--incident='.length) : 'startup-missing';
  const { server } = await createDemoServer({ codingAgentMode, incidentScenario });
  const port = Number(process.env.PORT ?? 4173);
  server.listen(port, '127.0.0.1', () => console.log(`REPLAY + MOCK + ${codingAgentMode} demo ready at http://127.0.0.1:${port} (LIVE evidence disabled)`));
}
