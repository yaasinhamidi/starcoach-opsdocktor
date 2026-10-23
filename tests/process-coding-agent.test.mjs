import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepairTask, FakeCodingAgentAdapter } from '../src/coding-agent.mjs';
import { ProcessFakeCodingAgentAdapter } from '../src/process-coding-agent.mjs';
import { RecoveryWorkflow } from '../src/recovery.mjs';
import { MockDeploymentProvider } from '../src/mock-provider.mjs';
import { createTrustedRecoveryWorkspace, verifyTrustedLocalHealth } from '../src/local-health.mjs';
import { createDemoServer } from '../src/demo-server.mjs';

async function post(url, path, payload) {
  const state = await (await fetch(`${url}/api/state`)).json();
  return fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    serverInstanceId: state.serverInstanceId, expectedRunId: state.runId, expectedGeneration: state.generation,
    operationId: randomUUID(), payload,
  }) });
}

function makeRequest() {
  return createRepairTask({ runId: randomUUID(), expectedGeneration: 2, operationId: randomUUID(), selectedReleaseId: 'release-broken-7',
    failureType: 'STARTUP_ENTRYPOINT_MISSING', sanitizedEvidence: [{ id: 'ev_0123456789abcdef', type: 'STARTUP_ENTRYPOINT_MISSING',
      summary: 'Selected failed release reports the configured startup entrypoint as missing.', details: { missingEntrypoint: 'missing.mjs' } }],
    sourceSnapshot: { packageJson: { scriptsStart: 'node missing.mjs', configPort: null }, liaraJson: null, existingEntrypoints: ['server.mjs'] } });
}

async function responseText(task, mutate = value => value) {
  const proposal = await new FakeCodingAgentAdapter().proposeRepair(task);
  const packet = mutate({ ok: true, proposal, worker: { pid: process.pid + 1000, ppid: process.pid } });
  return `${JSON.stringify(packet)}\n`;
}

function fakeSpawn({ stdout = '', stderr = '', code = 0, hang = false } = {}) {
  let child;
  const spawnImpl = () => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    child.stdin.once('finish', () => {
      if (hang) return;
      setImmediate(() => {
        if (stdout) child.stdout.write(stdout);
        if (stderr) child.stderr.write(stderr);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', code);
      });
    });
    return child;
  };
  return { spawnImpl, get child() { return child; } };
}

test('PROCESS_FAKE_AGENT uses a separate Node worker and returns a validated offline proposal', async () => {
  const request = makeRequest();
  let invocation;
  const adapter = new ProcessFakeCodingAgentAdapter({ spawnImpl: (executable, args, options) => {
    invocation = { executable, args, options };
    return spawn(executable, args, options);
  } });
  const proposal = await adapter.proposeRepair(request);
  assert.equal(adapter.mode, 'PROCESS_FAKE_AGENT');
  assert.equal(proposal.provenance.backend, 'PROCESS_FAKE_AGENT');
  assert.equal(proposal.requestId, request.requestId);
  assert.equal(proposal.operationId, request.operationId);
  assert.equal(proposal.selectedReleaseId, request.selectedReleaseId);
  assert.ok(Number.isSafeInteger(adapter.lastChildPid));
  assert.notEqual(adapter.lastChildPid, process.pid);
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.cwd.endsWith('src'), true);
  assert.equal(invocation.args.length, 1);
  assert.equal(invocation.args[0].endsWith('coding-agent-worker.mjs'), true);
  assert.deepEqual(Object.keys(invocation.options.env).sort(), Object.keys(invocation.options.env).filter(key => ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].includes(key)).sort());
  for (const key of ['LIARA_READONLY_TOKEN', 'BOXAPI_API_KEY', 'OPENROUTER_API_KEY', 'LIARA_LLM_OWNER_AUTHORIZED']) assert.equal(Object.hasOwn(invocation.options.env, key), false);
  assert.equal(proposal.changes[0].replacementContent, 'node server.mjs');
});

test('worker returns one structured sanitized error response for an invalid request', async () => {
  const workerUrl = new URL('../src/coding-agent-worker.mjs', import.meta.url);
  const workerPath = fileURLToPath(workerUrl);
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const child = spawn(process.execPath, [workerPath], { cwd: dirname(workerPath), env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code));
  });
  child.stdin.end('{"extra":"field"}\n');
  const code = await closed;
  assert.equal(code, 0);
  assert.equal(stderr, '');
  const response = JSON.parse(output);
  assert.deepEqual(Object.keys(response).sort(), ['error', 'ok', 'worker']);
  assert.equal(response.ok, false);
  assert.deepEqual(response.error, { code: 'INVALID_REQUEST' });
  assert.notEqual(response.worker.pid, process.pid);
  assert.equal(response.worker.ppid, process.pid);
});

test('end-to-end recovery uses the PROCESS_FAKE_AGENT child before approved fixture repair and MOCK success', async () => {
  const workspace = await createTrustedRecoveryWorkspace();
  try {
    const fixtureRoot = new URL('../fixtures/recovery-evidence/', import.meta.url);
    const [replayLogs, replayReleases] = await Promise.all([
      readFile(new URL('logs.json', fixtureRoot), 'utf8').then(JSON.parse),
      readFile(new URL('releases.json', fixtureRoot), 'utf8').then(JSON.parse),
    ]);
    const workflow = new RecoveryWorkflow({ projectRoot: workspace.appRoot, replayLogs, replayReleases,
      provider: new MockDeploymentProvider(), healthVerifier: verifyTrustedLocalHealth, codingAgent: 'PROCESS_FAKE_AGENT' });
    const diagnosed = await workflow.inspect();
    assert.equal(diagnosed.status, 'DIAGNOSED');
    assert.equal(diagnosed.codingAgent.source, 'PROCESS_FAKE_AGENT');
    assert.equal(diagnosed.codingAgent.transportProof, 'SEPARATE_NODE_PROCESS');
    assert.ok(Number.isSafeInteger(diagnosed.codingAgent.processId));
    assert.notEqual(diagnosed.codingAgent.processId, process.pid);
    assert.match(diagnosed.timeline.find(stage => stage.stage === 'CODING_AGENT_HANDOFF').status, /worker PID/);
    assert.equal(diagnosed.repair.proposal.provenance.backend, 'PROCESS_FAKE_AGENT');
    const approvedRepair = workflow.approveRepair(diagnosed.repair.digest);
    const repaired = await workflow.applyRepair(approvedRepair.repair.digest);
    assert.equal(repaired.localHttpHealth.source, 'LOCAL_HTTP');
    assert.equal(repaired.localHttpHealth.status, 'VERIFIED');
    const approvedDeploy = workflow.approveDeploy(repaired.deployDigest);
    const result = await workflow.deploy(approvedDeploy.deployDigest);
    assert.equal(result.result.outcome, 'SUCCESS');
    assert.equal(result.result.candidate.id, 'candidate-1');
    assert.deepEqual(result.result.verification, { ok: true, candidateId: 'candidate-1', state: 'READY', current: true, version: 'recovery-v2' });
  } finally { await workspace.cleanup(); }
});

test('Reset before inspection preserves PROCESS_FAKE_AGENT and launches a separate worker', async () => {
  const app = await createDemoServer({ codingAgentMode: 'PROCESS_FAKE_AGENT' });
  app.server.listen(0, '127.0.0.1');
  await new Promise(resolve => app.server.once('listening', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const initial = await (await fetch(`${url}/api/state`)).json();
    assert.equal(initial.status, 'READY');
    assert.equal(initial.codingAgent.source, 'PROCESS_FAKE_AGENT');
    const reset = await post(url, '/api/reset', { scenario: 'success', codingAgentMode: initial.codingAgent.source, incidentScenario: 'startup-missing' });
    assert.equal(reset.status, 200);
    const inspected = await post(url, '/api/inspect', {});
    assert.equal(inspected.status, 200);
    const state = await inspected.json();
    assert.equal(state.codingAgent.source, 'PROCESS_FAKE_AGENT');
    assert.equal(state.codingAgent.transportProof, 'SEPARATE_NODE_PROCESS');
    assert.ok(Number.isSafeInteger(state.codingAgent.processId));
    assert.notEqual(state.codingAgent.processId, process.pid);

    const approved = await post(url, '/api/approve-repair', { digest: state.repair.digest });
    const repaired = await post(url, '/api/apply-repair', { digest: (await approved.json()).repair.digest });
    const repairedState = await repaired.json();
    const deployApproval = await post(url, '/api/approve-deploy', { digest: repairedState.deployDigest });
    const deployed = await post(url, '/api/deploy', { digest: (await deployApproval.json()).deployDigest });
    assert.equal((await deployed.json()).status, 'SUCCESS');
    const afterCycle = await (await fetch(`${url}/api/state`)).json();
    const resetAfterCycle = await post(url, '/api/reset', { scenario: 'success', codingAgentMode: afterCycle.codingAgent.source, incidentScenario: 'startup-missing' });
    assert.equal(resetAfterCycle.status, 200);
    assert.equal((await resetAfterCycle.json()).codingAgent.source, 'PROCESS_FAKE_AGENT');
  } finally { await new Promise(resolve => app.server.close(resolve)); }
});

test('process bridge fails closed on timeout and kills its worker', async () => {
  const fake = fakeSpawn({ hang: true });
  const adapter = new ProcessFakeCodingAgentAdapter({ spawnImpl: fake.spawnImpl, timeoutMs: 30 });
  await assert.rejects(() => adapter.proposeRepair(makeRequest()), /TIMEOUT/);
  assert.equal(fake.child.killed, true);
  assert.equal(adapter.inFlight, false);
});

test('process bridge fails closed on worker crash and nonzero exit', async () => {
  const fake = fakeSpawn({ code: 1 });
  const adapter = new ProcessFakeCodingAgentAdapter({ spawnImpl: fake.spawnImpl });
  await assert.rejects(() => adapter.proposeRepair(makeRequest()), /UNEXPECTED_EXIT/);
});

test('process bridge rejects invalid, duplicate, mismatched and oversized responses', async () => {
  const request = makeRequest();
  const good = await responseText(request);
  const parsed = JSON.parse(good);
  const cases = [
    { output: 'not json\n', error: /INVALID_JSON/ },
    { output: `${good}${good}`, error: /INVALID_RESPONSE_COUNT/ },
    { output: `${good}\n`, error: /INVALID_RESPONSE_COUNT/ },
    { output: await responseText(request, packet => ({ ...packet, proposal: { ...packet.proposal, selectedReleaseId: 'wrong-release' } })), error: /does not match/ },
    { output: await responseText(request, packet => ({ ...packet, proposal: { ...packet.proposal, requestId: randomUUID() } })), error: /does not match/ },
    { output: await responseText(request, packet => ({ ...packet, proposal: { ...packet.proposal, evidenceIds: ['ev_0000000000000000'] } })), error: /does not match/ },
    { output: await responseText(request, packet => ({ ...packet, proposal: { ...packet.proposal, sourceSnapshotDigest: '0'.repeat(64) } })), error: /does not match/ },
    { output: await responseText(request, packet => ({ ...packet, proposal: { ...packet.proposal, changes: [{ ...packet.proposal.changes[0], path: '../package.json' }] } })), error: /Unsupported repair scope/ },
    { output: 'x'.repeat(17 * 1024), error: /OUTPUT_TOO_LARGE/ },
    { output: JSON.stringify({ ...parsed, duplicate: true }) + '\n', error: /INVALID_RESPONSE/ },
  ];
  for (const item of cases) {
    const adapter = new ProcessFakeCodingAgentAdapter({ spawnImpl: fakeSpawn({ stdout: item.output }).spawnImpl });
    await assert.rejects(() => adapter.proposeRepair(request), item.error);
  }
});

test('parallel handoffs are refused while one worker request is active', async () => {
  const fake = fakeSpawn({ hang: true });
  const adapter = new ProcessFakeCodingAgentAdapter({ spawnImpl: fake.spawnImpl, timeoutMs: 60 });
  const first = adapter.proposeRepair(makeRequest());
  await assert.rejects(() => adapter.proposeRepair(makeRequest()), /BUSY/);
  await assert.rejects(() => first, /TIMEOUT/);
});

test('the in-process adapter remains explicitly labeled as the compatibility mode', async () => {
  const proposal = await new FakeCodingAgentAdapter().proposeRepair(makeRequest());
  assert.equal(proposal.provenance.backend, 'FAKE_AGENT');
  assert.equal(proposal.provenance.modelId, null);
});

