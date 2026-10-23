import { MODEL_PROPOSAL_KEYS, validateRepairProposal, validateRepairTask } from './coding-agent.mjs';

const AUTHORIZATION_KEYS = [
  'backendId', 'executableId', 'provider', 'modelId', 'authenticationMethod', 'networkHosts',
  'maxInvocations', 'maxCostUsd', 'allowedData', 'sandboxId', 'testRepositoryScope',
  'maxInputBytes', 'maxOutputBytes', 'timeoutMs',
];
const ALLOWED_DATA = ['SANITIZED_FAILURE_EVIDENCE', 'ALLOWLISTED_SOURCE_SNAPSHOT'];
const MAX_CALLS = 10;
const MAX_BYTES = 64 * 1024;

function exactRecord(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some(key => typeof key !== 'string')
    || Reflect.ownKeys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw new TypeError(`Malformed ${label}`);
}

function validHost(host) {
  return typeof host === 'string' && host.length <= 253 && !host.includes('*')
    && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host);
}

function validateAuthorization(policy) {
  exactRecord(policy, AUTHORIZATION_KEYS, 'agent invocation authorization');
  for (const key of ['backendId', 'executableId', 'provider', 'modelId', 'authenticationMethod', 'sandboxId', 'testRepositoryScope']) {
    if (typeof policy[key] !== 'string' || !policy[key].trim() || Buffer.byteLength(policy[key]) > 512) throw new TypeError(`Invalid approved ${key}`);
  }
  if (policy.executableId.includes('\0') || !Array.isArray(policy.networkHosts) || policy.networkHosts.length > 10
    || policy.networkHosts.some(host => !validHost(host)) || new Set(policy.networkHosts).size !== policy.networkHosts.length) throw new TypeError('Invalid approved network or executable scope');
  if (!Array.isArray(policy.allowedData) || policy.allowedData.length !== ALLOWED_DATA.length
    || ALLOWED_DATA.some(value => !policy.allowedData.includes(value))) throw new TypeError('Approved data scope must name only sanitized evidence and the allowlisted source snapshot');
  if (!Number.isInteger(policy.maxInvocations) || policy.maxInvocations < 1 || policy.maxInvocations > MAX_CALLS
    || !Number.isFinite(policy.maxCostUsd) || policy.maxCostUsd < 0 || policy.maxCostUsd > 1000
    || !Number.isInteger(policy.maxInputBytes) || policy.maxInputBytes < 256 || policy.maxInputBytes > MAX_BYTES
    || !Number.isInteger(policy.maxOutputBytes) || policy.maxOutputBytes < 256 || policy.maxOutputBytes > MAX_BYTES
    || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 60_000) throw new TypeError('Invalid approved agent budgets');
  return policy;
}

function validateSandbox(sandbox, policy) {
  if (!sandbox || typeof sandbox !== 'object' || typeof sandbox.invoke !== 'function'
    || sandbox.identity !== policy.sandboxId || sandbox.enforced !== true || sandbox.cancellable !== true) throw new TypeError('A matching enforced, cancellable OS sandbox is required');
  const expectedHosts = [...policy.networkHosts].sort();
  const actualHosts = Array.isArray(sandbox.networkHosts) ? [...sandbox.networkHosts].sort() : null;
  if (sandbox.filesystemMode !== 'READ_ONLY' || !Array.isArray(sandbox.writablePaths) || sandbox.writablePaths.length !== 0
    || sandbox.tools !== 0 || sandbox.liaraCredentials !== false || sandbox.otherCredentials !== false
    || sandbox.repositoryScope !== policy.testRepositoryScope || !actualHosts
    || JSON.stringify(actualHosts) !== JSON.stringify(expectedHosts)) throw new TypeError('Sandbox policy does not match the approved no-write, scoped-network contract');
}

function parseModelResponse(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) === 0) throw new TypeError('Agent response is empty');
  let modelProposal;
  try { modelProposal = JSON.parse(stdout); } catch { throw new TypeError('Agent response is not valid JSON'); }
  exactRecord(modelProposal, MODEL_PROPOSAL_KEYS, 'model proposal');
  return modelProposal;
}

/**
 * Provider-neutral authentic adapter seam. It is intentionally not configured or wired by the
 * demo. Its sandboxRunner is part of the trusted host boundary and must enforce the policy checked
 * here; a normal child process is not sufficient. The offline test double is separately labeled.
 */
export class BoundedCodingAgentAdapter {
  #attempts = 0;
  #finalizedCostUsd = 0;
  #reservations = new Map();
  #authorization;
  #sandboxRunner;
  #estimateCost;
  mode;
  lastInvocation = null;
  inFlight = false;

  constructor({ authorization, sandboxRunner, estimateCost, offlineTestDouble = false } = {}) {
    validateAuthorization(authorization);
    validateSandbox(sandboxRunner, authorization);
    if (typeof estimateCost !== 'function') throw new TypeError('A trusted preflight cost estimator is required');
    if (offlineTestDouble && authorization.backendId !== 'OFFLINE_TEST_DOUBLE') throw new TypeError('Offline test double must use its distinct backend identity');
    if (!offlineTestDouble && authorization.backendId === 'OFFLINE_TEST_DOUBLE') throw new TypeError('Offline test double cannot be labeled as an authentic backend');
    if (!offlineTestDouble) throw codedError('AUTHENTIC_BACKEND_PENDING_SEPARATE_AUTHORIZATION_AND_TRUSTED_SANDBOX');
    this.#authorization = Object.freeze({ ...authorization, networkHosts: Object.freeze([...authorization.networkHosts]), allowedData: Object.freeze([...authorization.allowedData]) });
    this.#sandboxRunner = sandboxRunner;
    this.#estimateCost = estimateCost;
    Object.defineProperty(this, 'offlineTestDouble', { value: offlineTestDouble, writable: false, configurable: false });
    Object.defineProperty(this, 'mode', { value: 'TEST_DOUBLE', writable: false, configurable: false });
  }

  get attempts() { return this.#attempts; }
  /** In-memory accounting only: finalized transport charges plus active/unresolved reservations. */
  get estimatedSpendUsd() { return this.#finalizedCostUsd + [...this.#reservations.values()].reduce((sum, value) => sum + value, 0); }
  get finalizedCostUsd() { return this.#finalizedCostUsd; }
  get reservedCostUsd() { return [...this.#reservations.values()].reduce((sum, value) => sum + value, 0); }
  get unresolvedReservations() { return this.#reservations.size; }

  async proposeRepair(task) {
    if (this.inFlight) throw codedError('BUSY');
    validateSandbox(this.#sandboxRunner, this.#authorization);
    validateRepairTask(task);
    const payload = JSON.stringify(task);
    if (Buffer.byteLength(payload) > this.#authorization.maxInputBytes) throw codedError('INPUT_TOO_LARGE');
    if (this.#attempts >= this.#authorization.maxInvocations) throw codedError('INVOCATION_BUDGET_EXCEEDED');
    if (this.#reservations.size > 0) throw codedError('BILLING_OUTCOME_UNRESOLVED');
    const estimate = this.#estimateCost(task, this.#authorization);
    if (!Number.isFinite(estimate) || estimate < 0 || estimate > this.#authorization.maxCostUsd
      || this.estimatedSpendUsd + estimate > this.#authorization.maxCostUsd) throw codedError('COST_BUDGET_EXCEEDED');

    this.inFlight = true;
    this.#attempts += 1; // A timeout or provider error still consumes this invocation; never retry automatically.
    const reservationId = this.#attempts;
    this.#reservations.set(reservationId, estimate);
    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(task.timeoutMs, this.#authorization.timeoutMs));
    this.lastInvocation = { backendId: this.#authorization.backendId, modelId: this.#authorization.modelId,
      attempt: this.#attempts, status: 'RUNNING', estimatedCostUsd: estimate, reportedCostUsd: null, latencyMs: null };
    let reportedCostUsd = null;
    let billingKnown = false;
    try {
      const result = await this.#sandboxRunner.invoke({
        executableId: this.#authorization.executableId,
        fixedArgs: Object.freeze(['--model', this.#authorization.modelId, '--format', 'json']),
        provider: this.#authorization.provider,
        modelId: this.#authorization.modelId,
        authenticationMethod: this.#authorization.authenticationMethod,
        input: payload,
        signal: controller.signal,
        maxInputBytes: this.#authorization.maxInputBytes,
        maxOutputBytes: Math.min(task.maxPatchBytes + 8_192, this.#authorization.maxOutputBytes),
        networkHosts: this.#authorization.networkHosts,
        cwdScope: this.#authorization.testRepositoryScope,
        shell: false,
        writablePaths: Object.freeze([]),
        tools: Object.freeze([]),
      });
      const costDescriptor = result && typeof result === 'object' && !Array.isArray(result)
        && result.backendId === this.#authorization.backendId && result.modelId === this.#authorization.modelId
        ? Object.getOwnPropertyDescriptor(result, 'reportedCostUsd') : null;
      if (costDescriptor && Object.hasOwn(costDescriptor, 'value')
        && Number.isFinite(costDescriptor.value) && costDescriptor.value >= 0) {
        reportedCostUsd = costDescriptor.value;
        this.#reservations.delete(reservationId);
        this.#finalizedCostUsd += reportedCostUsd;
        billingKnown = true;
      }
      if (controller.signal.aborted) throw codedError('TIMEOUT_UNKNOWN');
      if (!result || ![5, 6].includes(Reflect.ownKeys(result).length)
        || Reflect.ownKeys(result).some(key => typeof key !== 'string')
        || Object.keys(result).some(key => !['backendId', 'modelId', 'invocationId', 'exitCode', 'stdout', 'reportedCostUsd'].includes(key))
        || result.backendId !== this.#authorization.backendId || result.modelId !== this.#authorization.modelId
        || typeof result.invocationId !== 'string' || result.invocationId.length > 128
        || result.exitCode !== 0 || typeof result.stdout !== 'string') throw codedError('BACKEND_FAILED');
      if (Buffer.byteLength(result.stdout) > this.#authorization.maxOutputBytes) throw codedError('OUTPUT_TOO_LARGE');
      if (reportedCostUsd === null) throw codedError('BILLING_OUTCOME_UNRESOLVED');
      if (this.#finalizedCostUsd > this.#authorization.maxCostUsd) throw codedError('REPORTED_COST_BUDGET_EXCEEDED');
      const modelProposal = parseModelResponse(result.stdout);
      const proposal = { ...modelProposal, provenance: { backend: this.mode, modelId: this.#authorization.modelId } };
      validateRepairProposal(task, proposal, this.mode);
      this.lastInvocation = { backendId: this.#authorization.backendId, modelId: this.#authorization.modelId, invocationId: result.invocationId, attempt: this.#attempts,
        status: 'COMPLETED', estimatedCostUsd: estimate, reportedCostUsd,
        billingStatus: 'FINALIZED', latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), semanticValidation: 'PASSED' };
      return proposal;
    } catch (error) {
      const timedOut = controller.signal.aborted;
      this.lastInvocation = { backendId: this.#authorization.backendId, modelId: this.#authorization.modelId, attempt: this.#attempts,
        status: timedOut ? 'UNKNOWN' : 'FAILED', estimatedCostUsd: estimate, reportedCostUsd,
        billingStatus: billingKnown ? 'FINALIZED' : 'UNRESOLVED_RESERVATION_RETAINED',
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), semanticValidation: 'NOT_PASSED' };
      if (timedOut) throw codedError('TIMEOUT_UNKNOWN');
      throw error;
    } finally {
      clearTimeout(timer);
      this.inFlight = false;
    }
  }
}

function codedError(code) {
  const error = new Error(`CODING_AGENT_${code}`);
  error.code = `CODING_AGENT_${code}`;
  return error;
}
