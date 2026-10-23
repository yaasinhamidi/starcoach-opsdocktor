import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { RecoveryWorkflow } from '../src/recovery.mjs';
import { MockDeploymentProvider } from '../src/mock-provider.mjs';
import { createDemoServer } from '../src/demo-server.mjs';
import { createTrustedRecoveryWorkspace, verifyTrustedLocalHealth } from '../src/local-health.mjs';
import { shouldApplyWorkflowResponse } from '../src/ui-response-order.mjs';
import { FakeCodingAgentAdapter } from '../src/coding-agent.mjs';
import { ProcessFakeCodingAgentAdapter } from '../src/process-coding-agent.mjs';

const evidenceRoot = new URL('../fixtures/recovery-evidence/', import.meta.url);
const fixtureJson = async name => JSON.parse(await readFile(new URL(name, evidenceRoot), 'utf8'));

function gate() {
  let open;
  const opened = new Promise(resolve => { open = resolve; });
  let reached;
  const arrived = new Promise(resolve => { reached = resolve; });
  return { open, opened, reached, arrived };
}

async function makeEnv({ provider, healthVerifier = verifyTrustedLocalHealth, codingAgent } = {}) {
  const inner = new MockDeploymentProvider();
  const counter = { writes: 0 };
  const wrapped = provider ?? { deploy: (...args) => { counter.writes += 1; return inner.deploy(...args); }, verifyCandidate: (...args) => inner.verifyCandidate(...args) };
  const workspace = await createTrustedRecoveryWorkspace();
  const workflow = new RecoveryWorkflow({ projectRoot: workspace.appRoot, replayLogs: await fixtureJson('logs.json'), replayReleases: await fixtureJson('releases.json'), provider: wrapped, healthVerifier, codingAgent });
  return { workflow, workspace, counter };
}

const isBusy = error => /BUSY/.test(error.message);

test('denyDeploy during an in-flight deploy fails BUSY and no write follows a denial', async () => {
  const { workflow, workspace, counter } = await makeEnv();
  try {
    const diagnosed = await workflow.inspect();
    workflow.approveRepair(diagnosed.repair.digest);
    const repaired = await workflow.applyRepair(diagnosed.repair.digest);
    workflow.approveDeploy(repaired.deployDigest);
    const deploying = workflow.deploy(repaired.deployDigest); // runs synchronously up to its first await
    assert.throws(() => workflow.denyDeploy(), isBusy);
    const result = await deploying;
    assert.equal(counter.writes, 1);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(workflow.snapshot().approval.deploy, 'USED');
  } finally { await workspace.cleanup(); }
});

test('a denial accepted before deploy starts blocks every provider write', async () => {
  const { workflow, workspace, counter } = await makeEnv();
  try {
    const diagnosed = await workflow.inspect();
    workflow.approveRepair(diagnosed.repair.digest);
    const repaired = await workflow.applyRepair(diagnosed.repair.digest);
    workflow.approveDeploy(repaired.deployDigest);
    workflow.denyDeploy();
    await assert.rejects(() => workflow.deploy(repaired.deployDigest));
    assert.equal(counter.writes, 0);
    assert.equal(workflow.snapshot().status, 'DEPLOY_DECLINED');
  } finally { await workspace.cleanup(); }
});

test('inspect fails BUSY while repair is applying and leaves workflow state untouched', async () => {
  const hold = gate();
  const { workflow, workspace } = await makeEnv({ healthVerifier: async root => { hold.reached(); await hold.opened; return verifyTrustedLocalHealth(root); } });
  try {
    const diagnosed = await workflow.inspect();
    workflow.approveRepair(diagnosed.repair.digest);
    const applying = workflow.applyRepair(diagnosed.repair.digest);
    await hold.arrived;
    const observation = workflow.observation;
    await assert.rejects(() => workflow.inspect(), isBusy);
    assert.equal(workflow.observation, observation);
    assert.equal(workflow.status, 'REINSPECTING');
    hold.open();
    assert.equal((await applying).status, 'REPAIRED');
  } finally { hold.open(); await workspace.cleanup(); }
});

test('inspect fails BUSY while deployment is in flight', async () => {
  const { workflow, workspace } = await makeEnv();
  try {
    const diagnosed = await workflow.inspect();
    workflow.approveRepair(diagnosed.repair.digest);
    const repaired = await workflow.applyRepair(diagnosed.repair.digest);
    workflow.approveDeploy(repaired.deployDigest);
    const deploying = workflow.deploy(repaired.deployDigest);
    await assert.rejects(() => workflow.inspect(), isBusy);
    assert.equal((await deploying).status, 'SUCCESS');
  } finally { await workspace.cleanup(); }
});

test('concurrent inspect cannot overlap a repair that starts mid-inspection', async () => {
  const { workflow, workspace } = await makeEnv();
  try {
    const diagnosed = await workflow.inspect();
    workflow.approveRepair(diagnosed.repair.digest);
    const second = workflow.inspect(); // claims the workflow before its first await
    await assert.rejects(() => workflow.applyRepair(diagnosed.repair.digest), isBusy);
    await second;
  } finally { await workspace.cleanup(); }
});

async function state(port) { return (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); }
async function post(port, path, payload = {}, identity = null, operationId = randomUUID()) {
  const current = identity ?? await state(port);
  const body = JSON.stringify({ serverInstanceId: current.serverInstanceId, expectedRunId: current.runId,
    expectedGeneration: current.generation, operationId, payload });
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('reset is refused with 409 while an operation is active and the workspace survives', async () => {
  const hold = gate();
  const { server, workflow } = await createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    workflow.healthVerifier = async root => { hold.reached(); await hold.opened; return verifyTrustedLocalHealth(root); };
    const diagnosed = await post(port, '/api/inspect');
    await post(port, '/api/approve-repair', { digest: diagnosed.json.repair.digest });
    const applying = post(port, '/api/apply-repair', { digest: diagnosed.json.repair.digest });
    await hold.arrived;
    const reset = await post(port, '/api/reset', { scenario: 'failed', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' });
    assert.equal(reset.status, 409);
    assert.match(reset.json.error, /CONFLICT|BUSY/);
    assert.equal(server.address() !== null, true);
    hold.open();
    const done = await applying;
    assert.equal(done.status, 200);
    assert.equal(done.json.status, 'REPAIRED');
    assert.equal((await post(port, '/api/reset', { scenario: 'failed', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' })).status, 200);
  } finally { hold.open(); await new Promise(resolve => server.close(resolve)); }
});

test('two barrier-overlapped resets have one winner and advance generation once', async () => {
  const hold = gate();
  let calls = 0;
  const sessionFactory = async () => {
    calls += 1;
    if (calls === 2) { hold.reached(); await hold.opened; }
    const env = await makeEnv();
    return { workflow: env.workflow, cleanup: env.workspace.cleanup };
  };
  const { server } = await createDemoServer({ sessionFactory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const before = await state(port);
    const first = post(port, '/api/reset', { scenario: 'success', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' }, before);
    await hold.arrived;
    const second = await post(port, '/api/reset', { scenario: 'failed', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' }, before);
    assert.equal(second.status, 409);
    assert.equal(second.json.error, 'BUSY');
    hold.open();
    const winner = await first;
    assert.equal(winner.status, 200);
    assert.equal(winner.json.generation, before.generation + 1);
    assert.equal(winner.json.mockScenario, 'success');
    assert.equal(calls, 2);
    assert.equal((await state(port)).runId, winner.json.runId);
  } finally { hold.open(); await new Promise(resolve => server.close(resolve)); }
});

test('stale approve, apply and deploy envelopes are rejected before touching the new run', async () => {
  const app = await createDemoServer();
  const { server } = app;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const old = await state(port);
    const reset = await post(port, '/api/reset', { scenario: 'success', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' }, old);
    assert.equal(reset.status, 200);
    for (const [path, payload] of [['/api/approve-repair', { digest: 'a'.repeat(64) }], ['/api/apply-repair', { digest: 'a'.repeat(64) }], ['/api/deploy', { digest: 'b'.repeat(64) }]]) {
      const response = await post(port, path, payload, old);
      assert.equal(response.status, 409, path);
      assert.equal(response.json.error, 'STALE_RUN', path);
    }
    const current = await state(port);
    assert.equal(current.runId, reset.json.runId);
    assert.equal(current.status, 'READY');
    assert.equal(current.result, null);
    assert.match(await readFile(join(app.workflow.projectRoot, 'package.json'), 'utf8'), /node missing\.mjs/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('stale generation and missing mutation envelopes fail closed', async () => {
  const { server } = await createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const current = await state(port);
    const staleGeneration = await post(port, '/api/inspect', {}, { ...current, generation: current.generation + 1 });
    assert.equal(staleGeneration.status, 409);
    assert.equal(staleGeneration.json.error, 'STALE_GENERATION');
    const missing = await fetch(`http://127.0.0.1:${port}/api/inspect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'INVALID_ENVELOPE');
    const clientLock = await post(port, '/api/inspect', { unresolvedDeployments: [] });
    assert.equal(clientLock.status, 400);
    assert.equal(clientLock.json.error, 'INVALID_ENVELOPE');
    assert.deepEqual(clientLock.json.unresolvedDeployments, []);
    assert.equal((await state(port)).status, 'READY');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('unavailable LIVE diagnosis returns truthful context and authoritative workflow error metadata', async () => {
  const { server } = await createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const identity = await state(port);
    const result = await post(port, '/api/live-diagnosis');
    assert.equal(result.status, 409);
    assert.equal(result.json.error, 'LIVE_EVIDENCE_UNAVAILABLE');
    assert.equal(result.json.serverInstanceId, identity.serverInstanceId);
    assert.equal(result.json.runId, identity.runId);
    assert.equal(result.json.generation, identity.generation);
    assert.deepEqual(result.json.unresolvedDeployments, []);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('duplicate and conflicting operation IDs never execute a second action', async () => {
  let calls = 0;
  const fake = new FakeCodingAgentAdapter();
  const env = await makeEnv({ codingAgent: { mode: 'FAKE_AGENT', async proposeRepair(request) { calls += 1; return fake.proposeRepair(request); } } });
  const { server } = await createDemoServer({ workflow: env.workflow });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const identity = await state(port);
    const operationId = randomUUID();
    const first = await post(port, '/api/inspect', {}, identity, operationId);
    assert.equal(first.status, 200);
    const duplicate = await post(port, '/api/inspect', {}, identity, operationId);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.json.error, 'DUPLICATE_OPERATION');
    const conflict = await post(port, '/api/deny-repair', {}, identity, operationId);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error, 'OPERATION_CONFLICT');
    assert.equal((await state(port)).status, 'DIAGNOSED');
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await env.workspace.cleanup(); }
});

test('a concurrent replay of one operation ID is rejected while its first request is in flight', async () => {
  const hold = gate();
  let calls = 0;
  const fake = new FakeCodingAgentAdapter();
  const env = await makeEnv({ codingAgent: { mode: 'FAKE_AGENT', async proposeRepair(request) { calls += 1; hold.reached(); await hold.opened; return fake.proposeRepair(request); } } });
  const { server } = await createDemoServer({ workflow: env.workflow });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const identity = await state(port);
    const operationId = randomUUID();
    const first = post(port, '/api/inspect', {}, identity, operationId);
    await hold.arrived;
    const duplicate = await post(port, '/api/inspect', {}, identity, operationId);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.json.error, 'DUPLICATE_OPERATION');
    hold.open();
    assert.equal((await first).status, 200);
    assert.equal(calls, 1);
  } finally { hold.open(); await new Promise(resolve => server.close(resolve)); await env.workspace.cleanup(); }
});

test('reset cannot dispose a workspace while a Process Bridge response is pending', async () => {
  const hold = gate();
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let input = '';
    child.stdin.on('data', chunk => { input += chunk.toString('utf8'); });
    child.stdin.once('finish', async () => {
      hold.reached(); await hold.opened;
      const request = JSON.parse(input);
      const proposal = await new FakeCodingAgentAdapter().proposeRepair(request);
      child.stdout.end(`${JSON.stringify({ ok: true, proposal, worker: { pid: process.pid + 1000, ppid: process.pid } })}\n`);
      child.stderr.end(); child.emit('close', 0);
    });
    return child;
  };
  const adapter = new ProcessFakeCodingAgentAdapter({ spawnImpl, timeoutMs: 5000 });
  const env = await makeEnv({ codingAgent: adapter });
  const { server } = await createDemoServer({ workflow: env.workflow });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const inspect = post(port, '/api/inspect');
    await hold.arrived;
    const old = await state(port);
    const reset = await post(port, '/api/reset', { scenario: 'success', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' }, old);
    assert.equal(reset.status, 409);
    assert.equal(reset.json.error, 'BUSY');
    hold.open();
    const inspected = await inspect;
    assert.equal(inspected.status, 200);
    assert.equal(inspected.json.runId, old.runId);
    assert.equal((await state(port)).status, 'DIAGNOSED');
  } finally { hold.open(); await new Promise(resolve => server.close(resolve)); await env.workspace.cleanup(); }
});

test('a disconnected Inspect client does not cancel ownership or permit Reset to dispose its workspace', async () => {
  const hold = gate();
  const done = gate();
  const adapter = { mode: 'FAKE_AGENT', async proposeRepair(request) {
    hold.reached(); await hold.opened; return new FakeCodingAgentAdapter().proposeRepair(request);
  } };
  const env = await makeEnv({ codingAgent: adapter });
  const originalInspect = env.workflow.inspect.bind(env.workflow);
  env.workflow.inspect = async () => { try { return await originalInspect(); } finally { done.reached(); } };
  const { server } = await createDemoServer({ workflow: env.workflow });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const identity = await state(port);
    const body = JSON.stringify({ serverInstanceId: identity.serverInstanceId, expectedRunId: identity.runId,
      expectedGeneration: identity.generation, operationId: randomUUID(), payload: {} });
    const client = new Promise(resolve => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/inspect', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', () => resolve('response')); });
      req.on('error', () => resolve('disconnected'));
      req.end(body);
      hold.arrived.then(() => req.destroy());
    });
    await hold.arrived;
    assert.equal(await client, 'disconnected');
    const refused = await post(port, '/api/reset', { scenario: 'success', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' }, identity);
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, 'BUSY');
    hold.open();
    await done.arrived;
    assert.equal(env.workflow.snapshot().status, 'DIAGNOSED');
    const accepted = await post(port, '/api/reset', { scenario: 'success', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' });
    assert.equal(accepted.status, 200);
  } finally { hold.open(); await new Promise(resolve => server.close(resolve)); await env.workspace.cleanup(); }
});

test('HTTP UNKNOWN lock is authoritative across reset, inspect, repair, approval errors, and blocked deploy', async () => {
  const inner = new MockDeploymentProvider();
  let dispatches = 0;
  const provider = {
    deploy(plan, approval) { dispatches += 1; inner.deploy(plan, approval); throw new Error('simulated timeout after request'); },
    verifyCandidate: (...args) => inner.verifyCandidate(...args),
  };
  const workspace = await createTrustedRecoveryWorkspace();
  const workflow = new RecoveryWorkflow({ projectRoot: workspace.appRoot, replayLogs: await fixtureJson('logs.json'),
    replayReleases: await fixtureJson('releases.json'), provider, healthVerifier: verifyTrustedLocalHealth,
    codingAgent: new FakeCodingAgentAdapter() });
  const { server } = await createDemoServer({ workflow });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const assertAuthoritative = response => {
      assert.equal(response.serverInstanceId, (awaitState.serverInstanceId));
      assert.ok(Array.isArray(response.unresolvedDeployments));
    };
    const awaitState = await state(port);
    const firstInspect = await post(port, '/api/inspect');
    assert.equal(firstInspect.status, 200);
    assertAuthoritative(firstInspect.json);
    let current = firstInspect.json;
    for (const [path, payload] of [
      ['/api/approve-repair', { digest: current.repair.digest }],
      ['/api/apply-repair', { digest: current.repair.digest }],
    ]) {
      const response = await post(port, path, payload);
      assert.equal(response.status, 200, path);
      assertAuthoritative(response.json);
      assert.deepEqual(response.json.unresolvedDeployments, []);
      current = response.json;
    }
    const firstDeployApproval = await post(port, '/api/approve-deploy', { digest: current.deployDigest });
    assert.equal(firstDeployApproval.status, 200);
    assertAuthoritative(firstDeployApproval.json);
    assert.deepEqual(firstDeployApproval.json.unresolvedDeployments, []);
    current = firstDeployApproval.json;
    const unknownResponse = await post(port, '/api/deploy', { digest: current.deployDigest });
    assert.equal(unknownResponse.status, 200);
    assertAuthoritative(unknownResponse.json);
    const unknown = unknownResponse.json;
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.result.outcome, 'UNKNOWN');
    assert.equal(unknown.unresolvedDeployments.length, 1);
    assert.equal(unknown.unresolvedDeployments[0].runId, current.runId);
    assert.equal(unknown.unresolvedDeployments[0].source, 'MOCK');
    assert.equal(dispatches, 1);
    const reset = await post(port, '/api/reset', { scenario: 'success', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' });
    assert.equal(reset.status, 200);
    assertAuthoritative(reset.json);
    assert.equal(reset.json.status, 'READY');
    assert.equal(reset.json.result, null);
    assert.equal(reset.json.generation, unknown.generation + 1);
    assert.equal(reset.json.unresolvedDeployments.length, 1);
    const freshInspect = await post(port, '/api/inspect');
    assertAuthoritative(freshInspect.json);
    assert.equal(freshInspect.json.unresolvedDeployments.length, 1);
    current = freshInspect.json;
    for (const [path, payload] of [
      ['/api/approve-repair', { digest: current.repair.digest }],
      ['/api/apply-repair', { digest: current.repair.digest }],
    ]) {
      const response = await post(port, path, payload);
      assert.equal(response.status, 200, path);
      assertAuthoritative(response.json);
      assert.equal(response.json.unresolvedDeployments.length, 1);
      current = response.json;
    }
    const blockedApproval = await post(port, '/api/approve-deploy', { digest: current.deployDigest });
    assert.equal(blockedApproval.status, 409);
    assert.equal(blockedApproval.json.error, 'UNKNOWN_REQUIRES_RECONCILIATION');
    assertAuthoritative(blockedApproval.json);
    assert.equal(blockedApproval.json.unresolvedDeployments.length, 1);
    const blockedDeploy = await post(port, '/api/deploy', { digest: current.deployDigest });
    assert.equal(blockedDeploy.status, 409);
    assert.equal(blockedDeploy.json.error, 'UNKNOWN_REQUIRES_RECONCILIATION');
    assertAuthoritative(blockedDeploy.json);
    assert.equal(blockedDeploy.json.unresolvedDeployments.length, 1);
    assert.equal(dispatches, 1);
    assert.equal((await state(port)).unresolvedDeployments.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await workspace.cleanup(); }
});

test('browser response ordering rejects late older, stale-run and wrong-server responses', () => {
  const current = { serverInstanceId: 'server-a', runId: 'run-b', generation: 3 };
  assert.equal(shouldApplyWorkflowResponse(current, { ...current, status: 'READY' }, 2, 1), true);
  assert.equal(shouldApplyWorkflowResponse(current, { ...current, status: 'old' }, 1, 2), false);
  assert.equal(shouldApplyWorkflowResponse(current, { ...current, generation: 2 }, 3, 1), false);
  assert.equal(shouldApplyWorkflowResponse(current, { ...current, runId: 'run-a', generation: 2 }, 3, 1), false);
  assert.equal(shouldApplyWorkflowResponse(current, { ...current, serverInstanceId: 'server-other' }, 3, 1), false);
});
