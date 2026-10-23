import { createHash, randomUUID } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVIDENCE_ID = /^ev_[a-f0-9]{16}$/;
const ENTRYPOINT = /^[A-Za-z0-9_-]{1,80}\.mjs$/;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 2048;
const TASK_KEYS = [
  'schemaVersion', 'requestId', 'runId', 'expectedGeneration', 'operationId', 'selectedReleaseId',
  'failureType', 'sanitizedEvidenceIds', 'sanitizedEvidence', 'sourceSnapshotDigest', 'sourceSnapshot',
  'allowedPaths', 'allowedOperations', 'maxChangedFiles', 'maxPatchBytes', 'timeoutMs', 'provenance',
];
const SNAPSHOT_KEYS = ['packageJson', 'liaraJson', 'existingEntrypoints'];
const PACKAGE_SNAPSHOT_KEYS = ['scriptsStart', 'configPort'];
const LIARA_SNAPSHOT_KEYS = ['port'];
const PROVENANCE_KEYS = ['source', 'releaseState'];
const EVIDENCE_KEYS = ['id', 'type', 'summary', 'details'];
const CHANGE_KEYS = ['path', 'operation', 'field', 'expectedOldContent', 'replacementContent'];
const PROPOSAL_KEYS = [
  'schemaVersion', 'requestId', 'runId', 'expectedGeneration', 'operationId', 'selectedReleaseId',
  'failureType', 'sourceSnapshotDigest', 'evidenceIds', 'status', 'diagnosis', 'explanation',
  'uncertainty', 'refusalReason', 'changes', 'provenance',
];
export const MODEL_PROPOSAL_KEYS = Object.freeze(PROPOSAL_KEYS.filter(key => key !== 'provenance'));
const EVIDENCE_TYPES = new Set(['STARTUP_ENTRYPOINT_MISSING', 'PORT_CONFIGURATION_MISMATCH']);
const FAILURE_TYPES = new Set(EVIDENCE_TYPES);
const BACKENDS = new Set(['FAKE_AGENT', 'PROCESS_FAKE_AGENT', 'AUTHENTIC_AGENT_LOCAL', 'TEST_DOUBLE']);
const REFUSAL_REASONS = new Set(['INSUFFICIENT_EVIDENCE', 'UNSUPPORTED_REPAIR', 'CONFLICTING_SOURCE']);

function exactRecord(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`Malformed ${label}`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string') || ownKeys.sort().join('\0') !== [...keys].sort().join('\0')) throw new TypeError(`Malformed ${label}`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`Malformed ${label}`);
  }
}

function exactArray(value, label, maxLength = 20) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength) throw new TypeError(`Malformed ${label}`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) throw new TypeError(`Malformed ${label}`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`Malformed ${label}`);
  }
  return value;
}

function boundedText(value, label, maxBytes = MAX_TEXT_BYTES) {
  if (typeof value !== 'string' || Buffer.byteLength(value) === 0 || Buffer.byteLength(value) > maxBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    || /ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s+prompt|assistant\s*[:>]|<\|(?:system|assistant|tool)/i.test(value)) throw new TypeError(`Invalid ${label}`);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function cloneFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFreeze));
  if (value && typeof value === 'object') {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = cloneFreeze(value[key]);
    return Object.freeze(copy);
  }
  return value;
}

export function digestSourceSnapshot(sourceSnapshot) {
  return sha(canonical(sourceSnapshot));
}

/** Accept only the deliberately supported single-file Node command form. */
export function configuredStartupEntrypoint(command) {
  if (typeof command !== 'string') return null;
  const match = /^node ([A-Za-z0-9_-]{1,80}\.mjs)$/.exec(command);
  return match?.[1] ?? null;
}

/** Build the bounded v2 RepairTask without retaining or forwarding raw log text. */
export function createRepairTask({
  requestId = randomUUID(), runId, expectedGeneration = 1, operationId = randomUUID(), selectedReleaseId,
  failureType, sanitizedEvidence, sourceSnapshot, provenance = { source: 'REPLAY', releaseState: 'FAILED' },
  timeoutMs = 5_000,
} = {}) {
  const task = {
    schemaVersion: '2.0', requestId, runId, expectedGeneration, operationId, selectedReleaseId,
    failureType, sanitizedEvidenceIds: Array.isArray(sanitizedEvidence) ? sanitizedEvidence.map(item => item?.id) : [],
    sanitizedEvidence, sourceSnapshotDigest: sourceSnapshot ? digestSourceSnapshot(sourceSnapshot) : '', sourceSnapshot,
    allowedPaths: ['package.json'], allowedOperations: ['REPLACE_JSON_FIELD'],
    maxChangedFiles: 1, maxPatchBytes: 4096, timeoutMs,
    provenance,
  };
  validateRepairTask(task);
  return cloneFreeze(task);
}

export function validateRepairTask(task) {
  exactRecord(task, TASK_KEYS, 'repair task');
  if (task.schemaVersion !== '2.0' || !UUID.test(task.requestId) || !UUID.test(task.runId)
    || !UUID.test(task.operationId) || !ID.test(task.selectedReleaseId)
    || !Number.isSafeInteger(task.expectedGeneration) || task.expectedGeneration < 1
    || !FAILURE_TYPES.has(task.failureType) || task.maxChangedFiles !== 1
    || !Number.isSafeInteger(task.maxPatchBytes) || task.maxPatchBytes < 1 || task.maxPatchBytes > 16_384
    || !Number.isInteger(task.timeoutMs) || task.timeoutMs < 25 || task.timeoutMs > 10_000) throw new TypeError('Invalid repair task fields');
  exactArray(task.allowedPaths, 'allowed paths', 1);
  exactArray(task.allowedOperations, 'allowed operations', 1);
  if (task.allowedPaths.length !== 1 || task.allowedPaths[0] !== 'package.json'
    || task.allowedOperations.length !== 1 || task.allowedOperations[0] !== 'REPLACE_JSON_FIELD') throw new TypeError('Unsupported repair scope');
  exactArray(task.sanitizedEvidenceIds, 'sanitized evidence IDs', 20);
  exactArray(task.sanitizedEvidence, 'sanitized evidence', 20);
  if (task.sanitizedEvidence.length < 1 || task.sanitizedEvidence.length !== task.sanitizedEvidenceIds.length) throw new TypeError('Invalid sanitized evidence');
  const seen = new Set();
  for (let index = 0; index < task.sanitizedEvidence.length; index++) {
    const evidence = task.sanitizedEvidence[index];
    exactRecord(evidence, EVIDENCE_KEYS, 'sanitized evidence item');
    if (!EVIDENCE_ID.test(evidence.id) || evidence.id !== task.sanitizedEvidenceIds[index] || seen.has(evidence.id)
      || !EVIDENCE_TYPES.has(evidence.type) || evidence.type !== task.failureType) throw new TypeError('Invalid evidence reference');
    seen.add(evidence.id);
    boundedText(evidence.summary, 'evidence summary', 300);
    exactRecord(evidence.details, evidence.type === 'STARTUP_ENTRYPOINT_MISSING' ? ['missingEntrypoint'] : ['applicationPort', 'deploymentPort'], 'evidence details');
    if (evidence.type === 'STARTUP_ENTRYPOINT_MISSING' && !ENTRYPOINT.test(evidence.details.missingEntrypoint)) throw new TypeError('Invalid missing entrypoint evidence');
    if (evidence.type === 'PORT_CONFIGURATION_MISMATCH' && (!validPort(evidence.details.applicationPort)
      || !validPort(evidence.details.deploymentPort) || evidence.details.applicationPort === evidence.details.deploymentPort)) throw new TypeError('Invalid port mismatch evidence');
  }
  exactRecord(task.sourceSnapshot, SNAPSHOT_KEYS, 'source snapshot');
  exactRecord(task.sourceSnapshot.packageJson, PACKAGE_SNAPSHOT_KEYS, 'package snapshot');
  if (task.sourceSnapshot.packageJson.scriptsStart !== null) boundedText(task.sourceSnapshot.packageJson.scriptsStart, 'package start snapshot', 512);
  if (task.sourceSnapshot.packageJson.configPort !== null && !validPort(task.sourceSnapshot.packageJson.configPort)) throw new TypeError('Invalid package port snapshot');
  if (task.sourceSnapshot.liaraJson !== null) {
    exactRecord(task.sourceSnapshot.liaraJson, LIARA_SNAPSHOT_KEYS, 'deployment contract snapshot');
    if (!validPort(task.sourceSnapshot.liaraJson.port)) throw new TypeError('Invalid deployment contract port');
  }
  exactArray(task.sourceSnapshot.existingEntrypoints, 'existing entrypoints', 20);
  if (task.sourceSnapshot.existingEntrypoints.some(path => typeof path !== 'string' || !ENTRYPOINT.test(path))
    || new Set(task.sourceSnapshot.existingEntrypoints).size !== task.sourceSnapshot.existingEntrypoints.length) throw new TypeError('Invalid entrypoint snapshot');
  const snapshotText = canonical(task.sourceSnapshot);
  if (Buffer.byteLength(snapshotText) > MAX_SNAPSHOT_BYTES || !DIGEST.test(task.sourceSnapshotDigest)
    || digestSourceSnapshot(task.sourceSnapshot) !== task.sourceSnapshotDigest) throw new TypeError('Source snapshot digest mismatch');
  exactRecord(task.provenance, PROVENANCE_KEYS, 'repair task provenance');
  if (task.provenance.source !== 'REPLAY' || task.provenance.releaseState !== 'FAILED') throw new TypeError('Repair task provenance mismatch');
  const evidenceTypes = new Set(task.sanitizedEvidence.map(item => item.type));
  if (evidenceTypes.size !== 1 || !evidenceTypes.has(task.failureType)) throw new TypeError('Failure type and evidence mismatch');
  if (task.failureType === 'STARTUP_ENTRYPOINT_MISSING') {
    const configuredEntrypoint = configuredStartupEntrypoint(task.sourceSnapshot.packageJson.scriptsStart);
    if (!configuredEntrypoint || task.sanitizedEvidence.some(item => configuredEntrypoint !== item.details.missingEntrypoint
      || task.sourceSnapshot.existingEntrypoints.includes(item.details.missingEntrypoint))) throw new TypeError('Startup evidence does not match source snapshot');
  } else if (task.failureType === 'PORT_CONFIGURATION_MISMATCH') {
    if (task.sanitizedEvidence.some(item => task.sourceSnapshot.packageJson.configPort !== item.details.applicationPort
      || task.sourceSnapshot.liaraJson?.port !== item.details.deploymentPort)) throw new TypeError('Port evidence does not match source snapshot');
  }
  return true;
}

function validPort(value) { return Number.isInteger(value) && value >= 1 && value <= 65535; }

function responseBase(task, backend) {
  return {
    schemaVersion: '2.0', requestId: task.requestId, runId: task.runId,
    expectedGeneration: task.expectedGeneration, operationId: task.operationId,
    selectedReleaseId: task.selectedReleaseId, failureType: task.failureType,
    sourceSnapshotDigest: task.sourceSnapshotDigest, evidenceIds: [...task.sanitizedEvidenceIds],
    provenance: { backend, modelId: null },
  };
}

function buildOfflineProposal(task, backend) {
  const base = responseBase(task, backend);
  let field;
  let expectedOldContent;
  let replacementContent;
  let diagnosis;
  let explanation;
  if (task.failureType === 'STARTUP_ENTRYPOINT_MISSING') {
    const missing = task.sanitizedEvidence[0].details.missingEntrypoint;
    const candidate = task.sourceSnapshot.existingEntrypoints.find(path => path !== missing);
    if (!candidate) return { ...base, status: 'NO_SAFE_REPAIR', diagnosis: 'The failed release references a missing startup file, but no safe replacement entrypoint was found in the bounded snapshot.', explanation: 'No file change is proposed because the allowlisted snapshot contains no verified replacement entrypoint.', uncertainty: 'HIGH', refusalReason: 'INSUFFICIENT_EVIDENCE', changes: [] };
    field = 'scripts.start';
    expectedOldContent = task.sourceSnapshot.packageJson.scriptsStart;
    replacementContent = `node ${candidate}`;
    diagnosis = `The selected failed release references ${missing}, while the bounded source snapshot contains ${candidate}.`;
    explanation = `Update scripts.start to launch the existing ${candidate} entrypoint.`;
  } else {
    const appPort = task.sourceSnapshot.packageJson.configPort;
    const deploymentPort = task.sourceSnapshot.liaraJson?.port;
    if (!validPort(appPort) || !validPort(deploymentPort) || appPort === deploymentPort) {
      return { ...base, status: 'NO_SAFE_REPAIR', diagnosis: 'The application and deployment contract ports are not both confirmed as different.', explanation: 'No file change is proposed because a port mismatch is not established by the bounded source snapshot.', uncertainty: 'HIGH', refusalReason: 'INSUFFICIENT_EVIDENCE', changes: [] };
    }
    field = 'config.port';
    expectedOldContent = appPort;
    replacementContent = deploymentPort;
    diagnosis = `package.json config.port (${appPort}) conflicts with the declared liara.json port (${deploymentPort}).`;
    explanation = `Set the application configuration to the explicitly declared deployment contract port ${deploymentPort}.`;
  }
  return {
    ...base, status: 'PROPOSED', diagnosis, explanation, uncertainty: 'LOW', refusalReason: null,
    changes: [{ path: 'package.json', operation: 'REPLACE_JSON_FIELD', field, expectedOldContent, replacementContent }],
  };
}

/** Deterministic offline double. It is explicitly not an authentic Coding Agent. */
export class FakeCodingAgentAdapter {
  mode = 'FAKE_AGENT';

  async proposeRepair(task) {
    validateRepairTask(task);
    const proposal = buildOfflineProposal(task, this.mode);
    validateRepairProposal(task, proposal, this.mode);
    return proposal;
  }
}

export function validateRepairProposal(task, proposal, expectedBackend = proposal?.provenance?.backend) {
  validateRepairTask(task);
  exactRecord(proposal, PROPOSAL_KEYS, 'repair proposal');
  if (proposal.schemaVersion !== '2.0' || proposal.requestId !== task.requestId || proposal.runId !== task.runId
    || proposal.expectedGeneration !== task.expectedGeneration || proposal.operationId !== task.operationId
    || proposal.selectedReleaseId !== task.selectedReleaseId || proposal.failureType !== task.failureType
    || proposal.sourceSnapshotDigest !== task.sourceSnapshotDigest
    || !Array.isArray(proposal.evidenceIds) || proposal.evidenceIds.length < 1
    || proposal.evidenceIds.some(id => !task.sanitizedEvidenceIds.includes(id))
    || new Set(proposal.evidenceIds).size !== proposal.evidenceIds.length) throw new TypeError('Repair proposal does not match its task');
  exactArray(proposal.evidenceIds, 'proposal evidence IDs', 20);
  exactRecord(proposal.provenance, ['backend', 'modelId'], 'repair proposal provenance');
  if (!BACKENDS.has(proposal.provenance.backend) || proposal.provenance.backend !== expectedBackend
    || (proposal.provenance.modelId !== null && (typeof proposal.provenance.modelId !== 'string' || proposal.provenance.modelId.length > 120))) throw new TypeError('Untrusted repair proposal provenance');
  if (!['PROPOSED', 'NO_SAFE_REPAIR'].includes(proposal.status) || !['LOW', 'MEDIUM', 'HIGH'].includes(proposal.uncertainty)
    || typeof proposal.refusalReason !== 'string' && proposal.refusalReason !== null) throw new TypeError('Invalid repair proposal status');
  boundedText(proposal.diagnosis, 'diagnosis');
  boundedText(proposal.explanation, 'proposal explanation');
  exactArray(proposal.changes, 'file changes', task.maxChangedFiles);
  if (proposal.status === 'NO_SAFE_REPAIR') {
    if (proposal.changes.length !== 0 || !REFUSAL_REASONS.has(proposal.refusalReason)) throw new TypeError('Invalid NO_SAFE_REPAIR proposal');
    return true;
  }
  if (proposal.refusalReason !== null || proposal.changes.length !== 1 || proposal.uncertainty === 'HIGH') throw new TypeError('Actionable proposal has invalid status');
  const change = proposal.changes[0];
  exactRecord(change, CHANGE_KEYS, 'file change');
  if (!task.allowedPaths.includes(change.path) || !task.allowedOperations.includes(change.operation) || change.path !== 'package.json') throw new TypeError('Unsupported repair scope');
  if (Buffer.byteLength(JSON.stringify(change.expectedOldContent)) + Buffer.byteLength(JSON.stringify(change.replacementContent)) > task.maxPatchBytes) throw new TypeError('Repair patch exceeds task limit');
  const pkg = task.sourceSnapshot.packageJson;
  if (task.failureType === 'STARTUP_ENTRYPOINT_MISSING') {
    if (change.field !== 'scripts.start' || change.expectedOldContent !== pkg.scriptsStart
      || typeof change.replacementContent !== 'string' || !/^node [A-Za-z0-9_-]{1,80}\.mjs$/.test(change.replacementContent)) throw new TypeError('Startup repair does not match its source snapshot');
    const target = change.replacementContent.slice('node '.length);
    if (!task.sourceSnapshot.existingEntrypoints.includes(target)
      || !task.sanitizedEvidence.some(item => proposal.evidenceIds.includes(item.id)
        && item.type === 'STARTUP_ENTRYPOINT_MISSING' && item.details.missingEntrypoint !== target)) throw new TypeError('Startup repair target is not evidence-backed');
  } else if (task.failureType === 'PORT_CONFIGURATION_MISMATCH') {
    if (change.field !== 'config.port' || change.expectedOldContent !== pkg.configPort
      || change.replacementContent !== task.sourceSnapshot.liaraJson?.port
      || change.expectedOldContent === change.replacementContent
      || !task.sanitizedEvidence.some(item => proposal.evidenceIds.includes(item.id)
        && item.type === 'PORT_CONFIGURATION_MISMATCH'
        && item.details.applicationPort === change.expectedOldContent
        && item.details.deploymentPort === change.replacementContent)) throw new TypeError('Port repair does not match the explicit contract');
  }
  return true;
}
