import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { RecoveryWorkflow } from '../src/recovery.mjs';
import { FakeCodingAgentAdapter } from '../src/coding-agent.mjs';
import { MockDeploymentProvider } from '../src/mock-provider.mjs';
import { createDemoServer } from '../src/demo-server.mjs';
import { createTrustedRecoveryWorkspace, verifyTrustedLocalHealth } from '../src/local-health.mjs';
import { DiagnosisProviderError } from '../src/diagnosis-providers.mjs';

const evidenceRoot = new URL('../fixtures/recovery-evidence/', import.meta.url);
async function fixtureJson(name) { return JSON.parse(await readFile(new URL(name, evidenceRoot), 'utf8')); }
async function postMutation(url, path, payload = {}) {
  const state = await (await fetch(`${url}/api/state`)).json();
  return fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    serverInstanceId: state.serverInstanceId, expectedRunId: state.runId, expectedGeneration: state.generation,
    operationId: randomUUID(), payload,
  }) });
}
async function makeWorkflow(provider = new MockDeploymentProvider(), codingAgent = new FakeCodingAgentAdapter()) {
  const workspace = await createTrustedRecoveryWorkspace();
  return { root: workspace.appRoot, workflow: new RecoveryWorkflow({ projectRoot: workspace.appRoot, replayLogs: await fixtureJson('logs.json'), replayReleases: await fixtureJson('releases.json'), provider, healthVerifier: verifyTrustedLocalHealth, codingAgent }), close: workspace.cleanup };
}

test('invalid failure envelope cannot leave the workflow in DIAGNOSED', async () => {
  const env = await makeWorkflow();
  try {
    env.workflow.replayLogs.releaseId = 'release id with spaces';
    env.workflow.replayLogs.lines.forEach(line => { line.releaseId = env.workflow.replayLogs.releaseId; });
    env.workflow.replayReleases.releases.push({ id: env.workflow.replayLogs.releaseId, state: 'FAILED', version: 'invalid-id', current: false });
    const state = await env.workflow.inspect();
    assert.notEqual(state.status, 'DIAGNOSED');
    assert.equal(state.incidentScenario, 'startup-missing');
    assert.equal(state.diagnosis.correlation, 'CONFIRMED');
    assert.equal(state.repair, null);
    assert.equal(state.handoff.status, 'NOT_SENT');
  } finally { await env.close(); }
});

test('failed Coding Agent handoff clears prior diagnosis and approval before reinspection', async () => {
  const fake = new FakeCodingAgentAdapter();
  let calls = 0;
  const adapter = { async proposeRepair(request) {
    calls++;
    if (calls === 1) return fake.proposeRepair(request);
    throw new Error('simulated worker failure');
  } };
  const env = await makeWorkflow(new MockDeploymentProvider(), adapter);
  try {
    const first = await env.workflow.inspect();
    env.workflow.approveRepair(first.repair.digest);
    await env.workflow.inspect();
    const failed = env.workflow.snapshot();
    assert.equal(failed.status, 'HANDOFF_FAILED');
    assert.equal(failed.repair, null);
    assert.equal(failed.handoff.status, 'FAILED');
    assert.equal(failed.approval.repair, 'REQUIRED');
    await assert.rejects(() => env.workflow.applyRepair(first.repair.digest), /diagnosis|approval/i);
  } finally { await env.close(); }
});

test('malformed Coding Agent proposal cannot create an actionable diagnosis', async () => {
  const fake = new FakeCodingAgentAdapter();
  const adapter = { async proposeRepair(request) { return { ...(await fake.proposeRepair(request)), requestId: 'wrong-request' }; } };
  const env = await makeWorkflow(new MockDeploymentProvider(), adapter);
  try {
    const state = await env.workflow.inspect();
    assert.equal(state.status, 'HANDOFF_FAILED');
    assert.equal(state.repair, null);
    assert.equal(state.codingAgent.status, 'FAILED');
  } finally { await env.close(); }
});

test('evidence changes after approval invalidate the one-use repair decision', async () => {
  const env = await makeWorkflow();
  try {
    const diagnosed = await env.workflow.inspect();
    env.workflow.approveRepair(diagnosed.repair.digest);
    env.workflow.replayLogs.lines.push({ releaseId: 'release-broken-7', level: 'error', message: 'Error: EADDRINUSE' });
    await assert.rejects(() => env.workflow.applyRepair(diagnosed.repair.digest), /Evidence changed after approval/);
    assert.equal(env.workflow.snapshot().status, 'REPAIR_BLOCKED');
    assert.equal(env.workflow.snapshot().repair, null);
    assert.equal(env.workflow.approvals.size, 0);
    assert.match(await readFile(join(env.root, 'package.json'), 'utf8'), /node missing\.mjs/);
  } finally { await env.close(); }
});

test('failed repository reinspection clears the previous repair diagnosis and approval', async () => {
  const env = await makeWorkflow();
  try {
    const diagnosed = await env.workflow.inspect();
    env.workflow.approveRepair(diagnosed.repair.digest);
    await writeFile(join(env.root, 'package.json'), '{ invalid json');
    await assert.rejects(() => env.workflow.inspect(), /previous diagnosis and approvals were cleared/);
    const state = env.workflow.snapshot();
    assert.equal(state.status, 'INSPECTION_FAILED');
    assert.equal(state.repair, null);
    assert.equal(state.handoff, null);
    assert.equal(state.approval.repair, 'REQUIRED');
    await assert.rejects(() => env.workflow.applyRepair(diagnosed.repair.digest), /Diagnosis is required/);
  } finally { await env.close(); }
});

test('offline recovery shows release-correlated diagnosis and requires two separate approvals', async () => {
  const env = await makeWorkflow();
  try {
    const diagnosis = await env.workflow.inspect();
    assert.equal(diagnosis.mode, 'REPLAY + MOCK');
    assert.equal(diagnosis.evidence.logs[0].releaseId, 'release-broken-7');
    assert.equal(diagnosis.evidence.priorHealthyRelease.id, 'release-stable-6');
    assert.equal(diagnosis.repair.after, 'node server.mjs');
    await assert.rejects(() => env.workflow.applyRepair(diagnosis.repair.digest), /approval/i);
    const approved = env.workflow.approveRepair(diagnosis.repair.digest);
    assert.equal(approved.status, 'AWAITING_REPAIR');
    const repaired = await env.workflow.applyRepair(diagnosis.repair.digest);
    assert.equal(repaired.status, 'REPAIRED');
    assert.deepEqual(repaired.evidence.findings, []);
    assert.equal(repaired.localHttpHealth.status, 'VERIFIED');
    assert.equal(repaired.localHttpHealth.genericFixtureLiveness.status, 'VERIFIED');
    assert.equal(repaired.localHttpHealth.configurationAgreement.status, 'NOT_APPLICABLE');
    assert.match(await readFile(join(env.root, 'package.json'), 'utf8'), /node server\.mjs/);
    await assert.rejects(() => env.workflow.deploy(repaired.deployDigest), /approval/i);
    const deployApproved = env.workflow.approveDeploy(repaired.deployDigest);
    const result = await env.workflow.deploy(deployApproved.deployDigest);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.result.outcome, 'SUCCESS');
    assert.equal(result.result.verification.candidateId, result.result.candidate.id);
    assert.equal(result.result.verification.version, 'recovery-v2');
    assert.equal(result.result.verification.state, 'READY');
    assert.equal(result.result.verification.current, true);
  } finally { await env.close(); }
});

test('logs without a matching release ID remain unconfirmed and do not produce a repair diagnosis', async () => {
  const env = await makeWorkflow();
  try {
    env.workflow.replayLogs.releaseId = 'release-does-not-exist';
    const state = await env.workflow.inspect();
    assert.equal(state.diagnosis.correlation, 'UNCONFIRMED');
    assert.equal(state.diagnosis.confidence, 'نامشخص');
    assert.equal(state.repair, null);
    assert.equal(state.evidence.logs[0].releaseId, null);
  } finally { await env.close(); }
});

test('missing supported replacement entrypoint is handed off as NO_SAFE_REPAIR with no actionable patch', async () => {
  const env = await makeWorkflow();
  try {
    await rm(join(env.root, 'server.mjs'));
    const state = await env.workflow.inspect();
    assert.equal(state.diagnosis.correlation, 'CONFIRMED');
    assert.equal(state.repair, null);
    assert.equal(state.status, 'NO_SAFE_REPAIR');
    assert.equal(state.diagnosis.recommendation, 'NO_SAFE_REPAIR');
    assert.equal(state.codingAgent.status, 'NO_SAFE_REPAIR');
  } finally { await env.close(); }
});

test('MODULE_NOT_FOUND for an imported dependency cannot diagnose the startup entrypoint failure', async () => {
  const env = await makeWorkflow();
  try {
    env.workflow.replayLogs.lines = [{
      timestamp: '2026-10-21T09:20:00Z', level: 'error', releaseId: 'release-broken-7',
      message: "Error: Cannot find module 'left-pad'", file: 'server.mjs', line: 1,
    }];
    const state = await env.workflow.inspect();
    assert.equal(state.diagnosis.correlation, 'UNCONFIRMED');
    assert.equal(state.repair, null);
    assert.equal(state.status, 'INSPECTED');
  } finally { await env.close(); }
});

test('startup release evidence must exactly match package scripts.start through the complete workflow', async () => {
  for (const command of ['node notmissing.mjs', 'node prefix-missing.mjs', 'node unrelated.mjs']) {
    const env = await makeWorkflow();
    try {
      const packagePath = join(env.root, 'package.json');
      const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
      pkg.scripts.start = command;
      await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
      const state = await env.workflow.inspect();
      assert.notEqual(state.status, 'DIAGNOSED', command);
      assert.equal(state.repair, null, command);
      assert.equal(state.handoff.status, 'NOT_SENT', command);
    } finally { await env.close(); }
  }
  const env = await makeWorkflow();
  try {
    const state = await env.workflow.inspect();
    assert.equal(state.status, 'DIAGNOSED');
    assert.equal(state.repair.after, 'node server.mjs');
  } finally { await env.close(); }
});

test('reinspection clears stale LOCAL_HTTP health without resetting one-use repair state', async () => {
  const env = await makeWorkflow();
  try {
    let state = await env.workflow.inspect();
    state = env.workflow.approveRepair(state.repair.digest);
    state = await env.workflow.applyRepair(state.repair.digest);
    assert.equal(state.localHttpHealth.status, 'VERIFIED');
    const oldDeployDigest = state.deployDigest;

    const packagePath = join(env.root, 'package.json');
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    pkg.scripts.start = 'node missing-again.mjs';
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    state = await env.workflow.inspect();
    assert.equal(state.localHttpHealth.status, 'NOT_RUN');
    assert.equal(state.approval.repair, 'USED');
    assert.notEqual(state.status, 'REPAIRED');
    assert.throws(() => env.workflow.approveDeploy(oldDeployDigest), /verified local HTTP health/);
    await assert.rejects(() => env.workflow.deploy(oldDeployDigest), /Separate deployment approval required/);
  } finally { await env.close(); }
});

test('healthy old release does not make a non-current candidate successful', async () => {
  const provider = new MockDeploymentProvider({ activateCandidate: false });
  const env = await makeWorkflow(provider);
  try {
    const diagnosis = await env.workflow.inspect();
    await env.workflow.approveRepair(diagnosis.repair.digest);
    const repaired = await env.workflow.applyRepair(diagnosis.repair.digest);
    const approved = env.workflow.approveDeploy(repaired.deployDigest);
    const result = await env.workflow.deploy(approved.deployDigest);
    assert.equal(result.result.outcome, 'FAILED');
    assert.equal(result.result.verification.current, false);
    assert.equal(provider.currentRelease, 'stable-1');
  } finally { await env.close(); }
});

test('repair approval becomes stale when its exact target content changes', async () => {
  const env = await makeWorkflow();
  try {
    const diagnosis = await env.workflow.inspect();
    env.workflow.approveRepair(diagnosis.repair.digest);
    await writeFile(join(env.root, 'package.json'), '{"scripts":{"start":"node other.mjs"}}\n');
    await assert.rejects(() => env.workflow.applyRepair(diagnosis.repair.digest), /changed after approval/i);
    assert.match(await readFile(join(env.root, 'package.json'), 'utf8'), /other\.mjs/);
  } finally { await env.close(); }
});

test('denial revokes an earlier repair approval and concurrent application is one-use', async () => {
  const env = await makeWorkflow();
  try {
    const diagnosis = await env.workflow.inspect();
    env.workflow.approveRepair(diagnosis.repair.digest);
    env.workflow.denyRepair();
    const inspectedAgain = await env.workflow.inspect();
    await assert.rejects(() => env.workflow.applyRepair(inspectedAgain.repair.digest), /approval required/i);
    env.workflow.approveRepair(inspectedAgain.repair.digest);
    const first = env.workflow.applyRepair(inspectedAgain.repair.digest);
    await assert.rejects(() => env.workflow.applyRepair(inspectedAgain.repair.digest), /BUSY|diagnosis|one-use/i);
    await first;
    assert.equal(env.workflow.snapshot().status, 'REPAIRED');
    assert.equal(env.workflow.snapshot().approval.repair, 'USED');
  } finally { await env.close(); }
});

test('deployment denial revokes the prior approval digest', async () => {
  const env = await makeWorkflow();
  try {
    const diagnosis = await env.workflow.inspect();
    env.workflow.approveRepair(diagnosis.repair.digest);
    const repaired = await env.workflow.applyRepair(diagnosis.repair.digest);
    env.workflow.approveDeploy(repaired.deployDigest);
    env.workflow.denyDeploy();
    await assert.rejects(() => env.workflow.deploy(repaired.deployDigest), /separate deployment approval/i);
    assert.equal(env.workflow.snapshot().approval.deploy, 'REQUIRED');
  } finally { await env.close(); }
});

test('ambiguous mock write produces UNKNOWN and is not retried', async () => {
  const inner = new MockDeploymentProvider();
  let calls = 0;
  const provider = {
    deploy(plan, approval) { calls++; inner.deploy(plan, approval); throw new Error('transport timeout after request'); },
    verifyCandidate: (...args) => inner.verifyCandidate(...args),
  };
  const env = await makeWorkflow(provider);
  try {
    const d = await env.workflow.inspect();
    env.workflow.approveRepair(d.repair.digest);
    const p = await env.workflow.applyRepair(d.repair.digest);
    const a = env.workflow.approveDeploy(p.deployDigest);
    const result = await env.workflow.deploy(a.deployDigest);
    assert.equal(result.result.outcome, 'UNKNOWN');
    assert.equal(calls, 1);
    await assert.rejects(() => env.workflow.deploy(a.deployDigest), /approval|diagnosis/i);
    assert.equal(calls, 1);
  } finally { await env.close(); }
});

test('demo HTTP server serves Persian UI and never requires live configuration', async () => {
  const env = await makeWorkflow();
  const { server } = await createDemoServer({ workflow: env.workflow });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(url);
    const html = await page.text();
    assert.match(html, /دستیار بازیابی/);
    assert.match(html, /LIVE READ-ONLY/);
    assert.match(html, /PROCESS_FAKE_AGENT/);
    assert.match(html, /id="incidentScenario"/);
    assert.match(html, /تشخیص شواهد REPLAY/);
    assert.match(html, /تشخیص شواهد LIVE_READ_ONLY/);
    assert.match(html, /<ol id="timeline"><\/ol>/);
    assert.match(html, /FAKE_AGENT/);
    assert.match(html, /تأییدها شبیه‌سازی‌شده‌اند/);
    assert.match(html, /LIVE_LLM/);
    assert.match(html, /providerState/);
    assert.match(html, /<span class="badge" id="modeBadge">REPLAY \+ MOCK<\/span>/);
    assert.match(html, /آداپتور:/);
    assert.match(html, /منشأ:/);
    assert.match(html, /@font-face\{font-family:Vazirmatn;src:url\("\/assets\/fonts\/Vazirmatn-Variable\.woff2"\) format\("woff2"\);font-weight:100 900;font-style:normal;font-display:swap\}/);
    assert.match(html, /font:400 16px\/1\.8 Vazirmatn,system-ui,sans-serif/);
    assert.match(html, /pre,code,kbd,samp\{direction:ltr;unicode-bidi:isolate;font-family:/);
    assert.match(html, /id="themePreference" class="theme-segment" role="group" aria-label="انتخاب پوسته"/);
    assert.equal((html.match(/<button type="button" data-theme-preference=/g) || []).length, 3);
    assert.match(html, /نمایش جزئیات فنی مراحل/);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
    const fontResponse = await fetch(`${url}/assets/fonts/Vazirmatn-Variable.woff2`);
    assert.equal(fontResponse.status, 200);
    assert.equal(fontResponse.headers.get('content-type'), 'font/woff2');
    const font = Buffer.from(await fontResponse.arrayBuffer());
    assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2');
    assert.equal(createHash('sha256').update(font).digest('hex'), '4e3fa217d38fdafc1fea4414ceb58ca5e662cf0ab5fa735a8c8c20e8b42cad92');
    assert.equal((await fetch(`${url}/assets/fonts/missing.woff2`)).status, 404);
    const response = await postMutation(url, '/api/inspect');
    const inspected = await response.json();
    assert.equal(inspected.status, 'DIAGNOSED');
    assert.equal(inspected.handoff.status, 'HANDED_OFF');
    assert.equal(inspected.codingAgent.source, 'FAKE_AGENT');
    assert.equal(inspected.timeline.find(item => item.stage === 'CANDIDATE_VERIFICATION').source, 'MOCK');
    const liveEvidence = await (await fetch(`${url}/api/live-evidence`)).json();
    assert.equal(liveEvidence.mode, 'UNAVAILABLE');
    assert.equal(liveEvidence.sourceToReleaseCorrespondence, 'UNCONFIRMED');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await env.close();
  }
});

test('demo reset creates a fresh workspace and preserves the selected mock scenario', async () => {
  const { server } = await createDemoServer();
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const reset = await postMutation(url, '/api/reset', { scenario: 'failed', codingAgentMode: 'FAKE_AGENT', incidentScenario: 'port-conflict' });
    const state = await reset.json();
    assert.equal(state.status, 'READY');
    assert.equal(state.mockScenario, 'failed');
    assert.equal(state.incidentScenario, 'port-conflict');
    assert.equal(state.localHttpHealth.status, 'NOT_RUN');
    const evidence = await (await fetch(`${url}/api/evidence`)).json();
    assert.equal(evidence.mode, 'REPLAY');
    assert.equal(evidence.source, 'REPLAY');
    assert.equal(evidence.liveMode, 'DISABLED');
    const liveEvidence = await (await fetch(`${url}/api/live-evidence`)).json();
    assert.equal(liveEvidence.mode, 'UNAVAILABLE');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('demo can select the PROCESS_FAKE_AGENT worker and an advisory-only incident scenario', async () => {
  const { server } = await createDemoServer({ codingAgentMode: 'PROCESS_FAKE_AGENT', incidentScenario: 'port-conflict' });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await postMutation(url, '/api/inspect');
    const state = await response.json();
    assert.equal(state.incidentScenario, 'port-conflict');
    assert.equal(state.status, 'UNSUPPORTED_REPAIR');
    assert.equal(state.diagnosis.code, 'PORT_BIND_CONFLICT');
    assert.equal(state.codingAgent.source, 'PROCESS_FAKE_AGENT');
    assert.equal(state.codingAgent.status, 'NOT_RUN');
    assert.equal(state.handoff.status, 'NOT_SENT');
    assert.equal(state.repair, null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('demo PROCESS_FAKE_AGENT mode performs real child-process handoff on inspection', async () => {
  const { server } = await createDemoServer({ codingAgentMode: 'PROCESS_FAKE_AGENT' });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await postMutation(`http://127.0.0.1:${server.address().port}`, '/api/inspect');
    const state = await response.json();
    assert.equal(state.codingAgent.source, 'PROCESS_FAKE_AGENT');
    assert.equal(state.codingAgent.transportProof, 'SEPARATE_NODE_PROCESS');
    assert.notEqual(state.codingAgent.processId, process.pid);
    assert.equal(state.repair.proposal.provenance.backend, 'PROCESS_FAKE_AGENT');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('demo routes enforce repair and deployment denial and reject a failed candidate', async () => {
  const { server } = await createDemoServer();
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const post = async (path, body = {}) => {
      if (path === '/api/reset') body = { codingAgentMode: 'FAKE_AGENT', incidentScenario: 'startup-missing', ...body };
      const response = await postMutation(url, path, body);
      return response.json();
    };

    let state = await post('/api/inspect');
    state = await post('/api/deny-repair');
    assert.equal(state.status, 'REPAIR_DECLINED');
    assert.equal(state.localHttpHealth.status, 'NOT_RUN');

    state = await post('/api/reset', { scenario: 'success' });
    state = await post('/api/inspect');
    state = await post('/api/approve-repair', { digest: state.repair.digest });
    state = await post('/api/apply-repair', { digest: state.repair.digest });
    assert.equal(state.localHttpHealth.status, 'VERIFIED');
    state = await post('/api/approve-deploy', { digest: state.deployDigest });
    state = await post('/api/deny-deploy');
    assert.equal(state.status, 'DEPLOY_DECLINED');
    assert.equal(state.result, null);

    state = await post('/api/reset', { scenario: 'failed' });
    state = await post('/api/inspect');
    state = await post('/api/approve-repair', { digest: state.repair.digest });
    state = await post('/api/apply-repair', { digest: state.repair.digest });
    state = await post('/api/approve-deploy', { digest: state.deployDigest });
    state = await post('/api/deploy', { digest: state.deployDigest });
    assert.equal(state.status, 'FAILED');
    assert.equal(state.result.outcome, 'FAILED');
    assert.equal(state.result.verification.state, 'FAILED');
    assert.equal(state.result.verification.current, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('read-only UI route presents sanitized release evidence without source binding or MOCK coupling', async () => {
  const env = await makeWorkflow();
  const calls = [];
  const readOnlyAdapter = {
    async getProject(name) { calls.push(['project', name]); return { status: 'AVAILABLE', data: { id: 'project-1', name } }; },
    async getReleases(name) { calls.push(['releases', name]); return { status: 'AVAILABLE', data: { releases: [{ id: 'release-1', tag: 'v1' }] } }; },
    async getReleaseLogs(name, options) {
      calls.push(['logs', name, options]);
      return { status: 'AVAILABLE', release: { id: 'release-1', tag: 'v1' }, correlation: 'CONFIRMED', startupFailure: { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' }, logs: [{ timestamp: '1792573200', releaseId: 'release-1', signals: ['MODULE_NOT_FOUND'], missingEntrypoint: 'missing.mjs' }], signals: ['MODULE_NOT_FOUND'] };
    },
  };
  const { server } = await createDemoServer({ workflow: env.workflow, liveReadOnlyAuthorized: true, readOnlyAdapter, liveProjectName: 'sanitized-demo-app', liveReleaseTag: 'v1', liveSince: 1792570000, liveUntil: 1792574000 });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const evidence = await (await fetch(`${url}/api/live-evidence`)).json();
    assert.equal(evidence.mode, 'LIVE READ-ONLY');
    assert.equal(evidence.logEvidence.releaseLogAttribution, 'CONFIRMED');
    assert.deepEqual(evidence.logEvidence.startupFailureIdentification, { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' });
    assert.equal(evidence.sourceToReleaseCorrespondence, 'UNCONFIRMED');
    assert.equal(calls.length, 3);
    assert.equal(calls[2][2].until, 1792574000);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await env.close();
  }
});

test('read-only UI route preserves UNKNOWN rather than presenting uncertain provider reads as available', async () => {
  const env = await makeWorkflow();
  const { server } = await createDemoServer({ workflow: env.workflow, liveReadOnlyAuthorized: true, liveProjectName: 'app', liveReleaseTag: 'v1', liveSince: 1792570000, liveUntil: 1792574000, readOnlyAdapter: {
    async getProject() { return { status: 'UNKNOWN', data: null }; },
    async getReleases() { return { status: 'AVAILABLE', data: { releases: [] } }; },
    async getReleaseLogs() { throw new Error('should not continue after release state unavailable'); },
  } });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const evidence = await (await fetch(`${url}/api/live-evidence`)).json();
    assert.equal(evidence.mode, 'UNKNOWN');
    assert.equal(evidence.sourceToReleaseCorrespondence, 'UNCONFIRMED');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await env.close();
  }
});

test('confirmed Liara read-only evidence reaches the provider-neutral diagnosis pipeline with selected-release provenance', async () => {
  const env = await makeWorkflow();
  let providerEvidence;
  const diagnosisProvider = {
    status: () => ({ provider: 'test-mock', model: 'fake', connection: 'MOCK' }),
    async diagnose(evidence) {
      providerEvidence = evidence;
      return { diagnosis: 'failed_release_missing_startup_entrypoint', summary: 'mocked structured finding', confidence: 'high', evidenceIds: evidence.items.map(item => item.id), repairHint: 'inspect-start-command', provider: 'test-mock', model: 'fake', mode: 'MOCK', origin: 'PROVIDER', adapter: 'shared', provenance: { adapter: 'shared', sdk: '@starcoach/core-llm@0.5.0', requestedModel: 'fake', returnedModel: 'fake', httpStatus: 200, latencyMs: 1, responseBytes: 1, attempts: 1 }, usage: null };
    },
  };
  const readOnlyAdapter = {
    async getProject(name) { return { status: 'AVAILABLE', data: { id: 'p1', name } }; },
    async getReleases() { return { status: 'AVAILABLE', data: { releases: [{ id: 'release-1', tag: 'v1', state: 'FAILED' }] } }; },
    async getReleaseLogs() { return { status: 'AVAILABLE', release: { id: 'release-1', tag: 'v1' }, correlation: 'CONFIRMED', releaseLogAttribution: 'CONFIRMED', startupFailure: { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' }, logs: [{ timestamp: '1792573200', releaseId: 'release-1', signals: ['MODULE_NOT_FOUND'], missingEntrypoint: 'missing.mjs' }], signals: ['MODULE_NOT_FOUND'] }; },
  };
  const { server } = await createDemoServer({ workflow: env.workflow, diagnosisProvider, liveReadOnlyAuthorized: true, readOnlyAdapter, liveProjectName: 'app', liveReleaseTag: 'v1', liveSince: 1792570000, liveUntil: 1792574000 });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await postMutation(`http://127.0.0.1:${server.address().port}`, '/api/live-diagnosis');
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.inputMode, 'LIVE_READ_ONLY');
    assert.equal(result.diagnosis.mode, 'MOCK');
    assert.equal(result.diagnosis.adapter, 'shared');
    assert.equal(result.diagnosis.provenance.sdk, '@starcoach/core-llm@0.5.0');
    assert.equal(providerEvidence.source, 'LIVE_READ_ONLY');
    assert.equal(providerEvidence.expectedReleaseId, 'release-1');
    assert.equal(providerEvidence.items[0].releaseId, 'release-1');
    assert.equal(result.sourceToReleaseCorrespondence, 'UNCONFIRMED');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await env.close();
  }
});

test('demo REPLAY diagnosis route normalizes confirmed evidence before deterministic diagnosis', async () => {
  const env = await makeWorkflow();
  const { server } = await createDemoServer({ workflow: env.workflow });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const early = await postMutation(url, '/api/diagnose');
    assert.equal(early.status, 409);
    await postMutation(url, '/api/inspect');
    const response = await postMutation(url, '/api/diagnose');
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.diagnosis.diagnosis, 'failed_release_missing_startup_entrypoint');
    assert.equal(result.diagnosis.origin, 'DETERMINISTIC');
    assert.equal(result.fallback, null);
    assert.match(result.diagnosis.evidenceIds[0], /^ev_[a-f0-9]{16}$/);
    assert.equal(result.diagnosis.usage, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await env.close();
  }
});

test('demo diagnosis route labels deterministic fallback and exposes provider configuration without secrets', async () => {
  const env = await makeWorkflow();
  const providerStatus = { provider: 'boxapi', model: 'openai/gpt-4.1-mini', adapter: 'shared', sdk: '@starcoach/core-llm@0.5.0',
    connection: 'CONFIGURED_UNVERIFIED', budget: 'CONFIGURED', evidenceMode: 'NOT_RUN' };
  const diagnosisProvider = {
    status: () => providerStatus,
    async diagnose() {
      throw new DiagnosisProviderError('HTTP_ERROR', 'Diagnosis provider returned HTTP 403', {
        httpStatus: 403, providerErrorCode: 'PERMISSION_DENIED',
        sanitizedProviderMessage: 'Provider denied model or endpoint permission.', latencyMs: 42,
      });
    },
  };
  const { server } = await createDemoServer({ workflow: env.workflow, diagnosisProvider });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const status = await (await fetch(`${url}/api/llm-status`)).json();
    assert.equal(status.adapter, 'shared');
    assert.equal(status.sdk, '@starcoach/core-llm@0.5.0');
    await postMutation(url, '/api/inspect');
    const response = await postMutation(url, '/api/diagnose');
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.diagnosis.origin, 'DETERMINISTIC');
    assert.equal(result.diagnosis.provider, 'offline');
    assert.equal(result.fallback.reason, 'HTTP_ERROR');
    assert.equal(result.fallback.httpStatus, 403);
    assert.equal(result.fallback.providerErrorCode, 'PERMISSION_DENIED');
    assert.equal(result.fallback.latencyMs, 42);
    assert.equal(result.providerStatus.adapter, 'shared');
    assert.equal(JSON.stringify(result).includes('apiKey'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await env.close();
  }
});
