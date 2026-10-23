import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { RecoveryWorkflow } from '../src/recovery.mjs';
import { MockDeploymentProvider } from '../src/mock-provider.mjs';
import { createDemoServer } from '../src/demo-server.mjs';
import { createTrustedRecoveryWorkspace, verifyTrustedLocalHealth } from '../src/local-health.mjs';
import { createDiagnosisProviderFromEnv } from '../src/diagnosis-providers.mjs';

const evidenceRoot = new URL('../fixtures/recovery-evidence/', import.meta.url);
const fixtureJson = async name => JSON.parse(await readFile(new URL(name, evidenceRoot), 'utf8'));

test('concurrent deployment requests reach the provider write at most once', async () => {
  const inner = new MockDeploymentProvider();
  let writes = 0;
  const provider = { deploy: (...args) => { writes += 1; return inner.deploy(...args); }, verifyCandidate: (...args) => inner.verifyCandidate(...args) };
  const workspace = await createTrustedRecoveryWorkspace();
  try {
    const workflow = new RecoveryWorkflow({ projectRoot: workspace.appRoot, replayLogs: await fixtureJson('logs.json'), replayReleases: await fixtureJson('releases.json'), provider, healthVerifier: verifyTrustedLocalHealth });
    const diagnosed = await workflow.inspect();
    workflow.approveRepair(diagnosed.repair.digest);
    const repaired = await workflow.applyRepair(diagnosed.repair.digest);
    workflow.approveDeploy(repaired.deployDigest);
    const outcomes = await Promise.allSettled([workflow.deploy(repaired.deployDigest), workflow.deploy(repaired.deployDigest)]);
    assert.equal(writes, 1);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(workflow.snapshot().status, 'SUCCESS');
  } finally { await workspace.cleanup(); }
});

function raw(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('demo server rejects foreign Host, cross-origin and non-JSON mutating requests without changing state', async () => {
  const { server, workflow } = await createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const before = JSON.stringify(workflow.snapshot());
    assert.equal((await raw(port, { path: '/api/state', headers: { host: 'attacker.example' } })).status, 403);
    assert.equal((await raw(port, { method: 'POST', path: '/api/inspect', headers: { host: `127.0.0.1:${port}`, origin: 'http://evil.example' } })).status, 403);
    assert.equal((await raw(port, { method: 'POST', path: '/api/reset', headers: { host: `127.0.0.1:${port}`, 'content-type': 'text/plain', 'content-length': '2' }, body: '{}' })).status, 403);
    assert.equal(JSON.stringify(workflow.snapshot()), before);
    const identity = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    const same = await raw(port, { method: 'POST', path: '/api/reset', headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body: JSON.stringify({
      serverInstanceId: identity.serverInstanceId, expectedRunId: identity.runId, expectedGeneration: identity.generation,
      operationId: randomUUID(), payload: { scenario: 'failed', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing' },
    }) });
    assert.equal(same.status, 200);
    assert.equal((await raw(port, { method: 'POST', path: '/api/reset', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, body: '[]' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('blank budget, rate or limit variables fail closed instead of reading as zero', async () => {
  const base = {
    LIARA_DIAGNOSIS_PROVIDER: 'boxapi', LIARA_LLM_OWNER_AUTHORIZED: 'YES', BOXAPI_API_KEY: 'test-key-not-real', LIARA_BOXAPI_MODEL: 'test-model',
    LIARA_LLM_MAX_ATTEMPTS: '1', LIARA_LLM_WINDOW_SECONDS: '60', LIARA_LLM_MAX_CONCURRENT: '1',
    LIARA_LLM_MAX_REQUEST_COST_USD: '0.01', LIARA_BOXAPI_INPUT_USD_PER_MILLION: '1', LIARA_BOXAPI_OUTPUT_USD_PER_MILLION: '1',
  };
  let sent = 0;
  const fetchImpl = async () => { sent += 1; throw new Error('must not be called'); };
  const evidence = { source: 'REPLAY', expectedReleaseId: 'r1', items: [{ id: 'ev_0123456789abcdef', releaseId: 'r1', signals: ['MODULE_NOT_FOUND'], missingEntrypoint: 'missing.mjs', releaseState: 'FAILED' }] };
  for (const name of ['LIARA_BOXAPI_INPUT_USD_PER_MILLION', 'LIARA_BOXAPI_OUTPUT_USD_PER_MILLION', 'LIARA_LLM_MAX_REQUEST_COST_USD']) {
    const provider = createDiagnosisProviderFromEnv({ ...base, [name]: '  ' }, { fetchImpl });
    assert.equal(provider.status().budget, 'MISSING_CONFIGURATION', name);
    await assert.rejects(() => provider.diagnose(evidence), error => error.code === 'BUDGET_UNCONFIGURED', name);
  }
  assert.equal(sent, 0);
});
