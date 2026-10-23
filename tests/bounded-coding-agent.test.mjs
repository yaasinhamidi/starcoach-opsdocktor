import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BoundedCodingAgentAdapter } from '../src/bounded-coding-agent.mjs';
import { createRepairTask, FakeCodingAgentAdapter, MODEL_PROPOSAL_KEYS } from '../src/coding-agent.mjs';

function task() {
  return createRepairTask({ runId: randomUUID(), expectedGeneration: 1, operationId: randomUUID(), selectedReleaseId: 'release-1',
    failureType: 'PORT_CONFIGURATION_MISMATCH', sanitizedEvidence: [{ id: 'ev_0123456789abcdef', type: 'PORT_CONFIGURATION_MISMATCH',
      summary: 'Confirmed package.json config.port 3000 differs from liara.json port 8080.', details: { applicationPort: 3000, deploymentPort: 8080 } }],
    sourceSnapshot: { packageJson: { scriptsStart: 'node server.mjs', configPort: 3000 }, liaraJson: { port: 8080 }, existingEntrypoints: ['server.mjs'] } });
}

function authorization(overrides = {}) {
  return {
    backendId: 'OFFLINE_TEST_DOUBLE', executableId: 'offline-test-double', provider: 'fixture', modelId: 'test/repair-model',
    authenticationMethod: 'NONE', networkHosts: [], maxInvocations: 1, maxCostUsd: 0.05,
    allowedData: ['SANITIZED_FAILURE_EVIDENCE', 'ALLOWLISTED_SOURCE_SNAPSHOT'], sandboxId: 'offline-test-sandbox',
    testRepositoryScope: 'fixture://opsdocktor-test', maxInputBytes: 16_384, maxOutputBytes: 16_384, timeoutMs: 1_000,
    ...overrides,
  };
}

function sandbox(invoke, overrides = {}) {
  return {
    identity: 'offline-test-sandbox', enforced: true, cancellable: true, filesystemMode: 'READ_ONLY', writablePaths: [],
    networkHosts: [], tools: 0, liaraCredentials: false, otherCredentials: false,
    repositoryScope: 'fixture://opsdocktor-test', invoke, ...overrides,
  };
}

async function modelOutput(inputTask, mutate = value => value) {
  const proposal = await new FakeCodingAgentAdapter().proposeRepair(inputTask);
  const modelProposal = Object.fromEntries(MODEL_PROPOSAL_KEYS.map(key => [key, proposal[key]]));
  return JSON.stringify(mutate(modelProposal));
}

test('bounded adapter refuses missing authorization, weak sandbox, wildcard network and non-double test identity', () => {
  const noOp = async () => {};
  assert.throws(() => new BoundedCodingAgentAdapter(), /Malformed agent invocation authorization/);
  assert.throws(() => new BoundedCodingAgentAdapter({ authorization: authorization(), sandboxRunner: sandbox(noOp, { enforced: false }), estimateCost: () => 0 }), /enforced, cancellable OS sandbox/);
  assert.throws(() => new BoundedCodingAgentAdapter({ authorization: authorization({ networkHosts: ['*.example.com'] }), sandboxRunner: sandbox(noOp, { networkHosts: ['*.example.com'] }), estimateCost: () => 0, offlineTestDouble: true }), /Invalid approved network/);
  assert.throws(() => new BoundedCodingAgentAdapter({ authorization: authorization({ backendId: 'KILO_CODE' }), sandboxRunner: sandbox(noOp), estimateCost: () => 0, offlineTestDouble: true }), /distinct backend identity/);
  assert.throws(() => new BoundedCodingAgentAdapter({ authorization: authorization(), sandboxRunner: sandbox(noOp, { writablePaths: ['D:/repo'] }), estimateCost: () => 0 }), /Sandbox policy does not match/);
  assert.throws(() => new BoundedCodingAgentAdapter({ authorization: authorization({ backendId: 'KILO_CODE' }), sandboxRunner: sandbox(noOp), estimateCost: () => 0 }), /AUTHENTIC_BACKEND_PENDING_SEPARATE_AUTHORIZATION_AND_TRUSTED_SANDBOX/);
});

test('bounded adapter sends only the validated structured task and returns clearly labeled offline-double provenance', async () => {
  const inputTask = task();
  let invocation;
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization(), estimateCost: () => 0.01,
    offlineTestDouble: true, sandboxRunner: sandbox(async args => {
      invocation = args;
      return { backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: 'fixture-call-1', exitCode: 0,
        stdout: await modelOutput(inputTask), reportedCostUsd: 0 };
    }) });
  const proposal = await adapter.proposeRepair(inputTask);
  assert.equal(adapter.mode, 'TEST_DOUBLE');
  assert.equal(proposal.provenance.backend, 'TEST_DOUBLE');
  assert.equal(proposal.provenance.modelId, 'test/repair-model');
  assert.deepEqual(JSON.parse(invocation.input), inputTask);
  assert.equal(invocation.executableId, 'offline-test-double');
  assert.deepEqual(invocation.fixedArgs, ['--model', 'test/repair-model', '--format', 'json']);
  assert.equal(invocation.shell, false);
  assert.deepEqual(invocation.writablePaths, []);
  assert.deepEqual(invocation.tools, []);
  assert.equal(adapter.attempts, 1);
  assert.equal(adapter.lastInvocation.status, 'COMPLETED');
  assert.equal(adapter.lastInvocation.reportedCostUsd, 0);
  assert.equal(adapter.lastInvocation.semanticValidation, 'PASSED');
});

test('cost preflight and invocation count fail closed before a second transport call', async () => {
  let calls = 0;
  const tooExpensive = new BoundedCodingAgentAdapter({ authorization: authorization({ maxCostUsd: 0.005 }),
    sandboxRunner: sandbox(async () => { calls++; return {}; }), estimateCost: () => 0.01, offlineTestDouble: true });
  await assert.rejects(() => tooExpensive.proposeRepair(task()), /COST_BUDGET_EXCEEDED/);
  assert.equal(calls, 0);

  const inputTask = task();
  const bounded = new BoundedCodingAgentAdapter({ authorization: authorization(), estimateCost: () => 0.01, offlineTestDouble: true,
    sandboxRunner: sandbox(async () => { calls++; return { backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: 'call', exitCode: 0, stdout: await modelOutput(inputTask), reportedCostUsd: 0.01 }; }) });
  await bounded.proposeRepair(inputTask);
  await assert.rejects(() => bounded.proposeRepair(inputTask), /INVOCATION_BUDGET_EXCEEDED/);
  assert.equal(calls, 1);
});

test('timeout is UNKNOWN, consumes the invocation, and does not trigger an automatic retry', async () => {
  const inputTask = createRepairTask({ ...task(), timeoutMs: 25 });
  let calls = 0;
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization(), estimateCost: () => 0.01, offlineTestDouble: true,
    sandboxRunner: sandbox(({ signal }) => {
      calls++;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }) });
  await assert.rejects(() => adapter.proposeRepair(inputTask), /TIMEOUT_UNKNOWN/);
  assert.equal(adapter.lastInvocation.status, 'UNKNOWN');
  assert.equal(adapter.attempts, 1);
  await assert.rejects(() => adapter.proposeRepair(inputTask), /INVOCATION_BUDGET_EXCEEDED/);
  assert.equal(calls, 1);
});

test('timeout keeps its reservation and blocks another dispatch when billing is unknown', async () => {
  const inputTask = createRepairTask({ ...task(), timeoutMs: 25 });
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization({ maxInvocations: 3 }), estimateCost: () => 0.01,
    offlineTestDouble: true, sandboxRunner: sandbox(({ signal }) => new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))) });
  await assert.rejects(() => adapter.proposeRepair(inputTask), /TIMEOUT_UNKNOWN/);
  assert.equal(adapter.reservedCostUsd, 0.01);
  assert.equal(adapter.unresolvedReservations, 1);
  await assert.rejects(() => adapter.proposeRepair(inputTask), /BILLING_OUTCOME_UNRESOLVED/);
  assert.equal(adapter.attempts, 1);
});

test('missing transport billing metadata retains its reservation and blocks repeated requests', async () => {
  const inputTask = task();
  let calls = 0;
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization({ maxInvocations: 3 }), estimateCost: () => 0.01,
    offlineTestDouble: true, sandboxRunner: sandbox(async () => {
      calls++;
      return { backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: `no-billing-${calls}`,
        exitCode: 0, stdout: await modelOutput(inputTask) };
    }) });
  await assert.rejects(() => adapter.proposeRepair(inputTask), /BILLING_OUTCOME_UNRESOLVED/);
  assert.equal(adapter.reservedCostUsd, 0.01);
  assert.equal(adapter.finalizedCostUsd, 0);
  assert.equal(adapter.unresolvedReservations, 1);
  await assert.rejects(() => adapter.proposeRepair(inputTask), /BILLING_OUTCOME_UNRESOLVED/);
  assert.equal(calls, 1);
});

test('malicious and semantically unsupported model output never becomes an actionable proposal', async () => {
  const inputTask = task();
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization(), estimateCost: () => 0.01, offlineTestDouble: true,
    sandboxRunner: sandbox(async () => ({ backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: 'call', exitCode: 0,
      stdout: await modelOutput(inputTask, value => ({ ...value, changes: [{ ...value.changes[0], replacementContent: 3001 }] })), reportedCostUsd: 0.01 })) });
  await assert.rejects(() => adapter.proposeRepair(inputTask), /Port repair does not match/);
  assert.equal(adapter.lastInvocation.semanticValidation, 'NOT_PASSED');
  assert.equal(adapter.lastInvocation.reportedCostUsd, 0.01);
  assert.equal(adapter.finalizedCostUsd, 0.01);
  assert.equal(adapter.reservedCostUsd, 0);
});

test('known transport cost is finalized before JSON parsing even when parsing fails', async () => {
  const inputTask = task();
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization(), estimateCost: () => 0.01, offlineTestDouble: true,
    sandboxRunner: sandbox(async () => ({ backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: 'bad-json',
      exitCode: 0, stdout: '{not json', reportedCostUsd: 0.02 })) });
  await assert.rejects(() => adapter.proposeRepair(inputTask), /not valid JSON/);
  assert.equal(adapter.finalizedCostUsd, 0.02);
  assert.equal(adapter.estimatedSpendUsd, 0.02);
  assert.equal(adapter.lastInvocation.reportedCostUsd, 0.02);
  assert.equal(adapter.unresolvedReservations, 0);
});

test('review over-budget example records trusted $0.06 despite a $0.01 estimate and $0.05 budget', async () => {
  const inputTask = task();
  let calls = 0;
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization({ maxInvocations: 3, maxCostUsd: 0.05 }),
    estimateCost: () => 0.01, offlineTestDouble: true,
    sandboxRunner: sandbox(async () => { calls++; return { backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: 'over-budget',
      exitCode: 0, stdout: await modelOutput(inputTask), reportedCostUsd: 0.06 }; }) });
  await assert.rejects(() => adapter.proposeRepair(inputTask), /REPORTED_COST_BUDGET_EXCEEDED/);
  assert.equal(adapter.finalizedCostUsd, 0.06);
  assert.equal(adapter.estimatedSpendUsd, 0.06);
  assert.equal(adapter.lastInvocation.reportedCostUsd, 0.06);
  assert.equal(adapter.unresolvedReservations, 0);
  await assert.rejects(() => adapter.proposeRepair(inputTask), /COST_BUDGET_EXCEEDED/);
  assert.equal(calls, 1);
});

test('repeated requests finalize transport charges and stop before cumulative estimates exceed budget', async () => {
  const inputTask = task();
  let calls = 0;
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization({ maxInvocations: 5 }),
    estimateCost: () => 0.02, offlineTestDouble: true,
    sandboxRunner: sandbox(async () => { calls++; return { backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: `call-${calls}`,
      exitCode: 0, stdout: await modelOutput(inputTask), reportedCostUsd: 0.02 }; }) });
  await adapter.proposeRepair(inputTask);
  await adapter.proposeRepair(inputTask);
  assert.equal(adapter.finalizedCostUsd, 0.04);
  await assert.rejects(() => adapter.proposeRepair(inputTask), /COST_BUDGET_EXCEEDED/);
  assert.equal(calls, 2);
  assert.equal(adapter.attempts, 2);
});

test('model-written cost metadata is rejected and never changes transport billing', async () => {
  const inputTask = task();
  const adapter = new BoundedCodingAgentAdapter({ authorization: authorization(), estimateCost: () => 0.01, offlineTestDouble: true,
    sandboxRunner: sandbox(async () => ({ backendId: 'OFFLINE_TEST_DOUBLE', modelId: 'test/repair-model', invocationId: 'model-cost',
      exitCode: 0, stdout: await modelOutput(inputTask, value => ({ ...value, reportedCostUsd: 0.5 })), reportedCostUsd: 0.01 })) });
  await assert.rejects(() => adapter.proposeRepair(inputTask), /Malformed model proposal/);
  assert.equal(adapter.finalizedCostUsd, 0.01);
  assert.equal(adapter.lastInvocation.reportedCostUsd, 0.01);
});
