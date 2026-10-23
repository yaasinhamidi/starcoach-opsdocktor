import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LiaraReadOnlyAdapter } from '../src/liara-readonly.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`../fixtures/liara-api/${name}`, import.meta.url), 'utf8'));

test('read-only adapter uses explicit teamID and returns only allowlisted project fields', async () => {
  const project = await fixture('project.json');
  const requests = [];
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', teamId: 'team-42', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => project };
  } });
  const result = await adapter.getProject('sanitized-demo-app');
  assert.deepEqual(result, { status: 'AVAILABLE', httpStatus: 200, data: { id: 'project-fixture-001', name: 'sanitized-demo-app', type: 'node', status: 'RUNNING', isDeployed: true } });
  assert.ok(!JSON.stringify(result).includes('fixture-never-return-this'));
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(new URL(requests[0].url).origin, 'https://api.liara.ir');
  assert.equal(new URL(requests[0].url).searchParams.get('teamID'), 'team-42');
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-secret');
});

test('v1 logs follow the documented since contract and never claim release attribution', async () => {
  const logs = await fixture('logs.json');
  const requests = [];
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', teamId: 'team-42', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => logs };
  } });
  const result = await adapter.getLogs('sanitized-demo-app', '2026-10-21T10:00:00Z');
  assert.deepEqual(result, { status: 'AVAILABLE', httpStatus: 200, correlation: 'UNCONFIRMED', releaseLogAttribution: 'UNCONFIRMED', startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null }, sourceToReleaseCorrespondence: 'UNCONFIRMED', count: 2, signals: [] });
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, '/v1/projects/sanitized-demo-app/logs');
  assert.equal(url.searchParams.get('since'), '2026-10-21T10:00:00Z');
  assert.equal(url.searchParams.get('teamID'), 'team-42');
  assert.equal(requests[0].options.method, 'GET');
  assert.ok(!JSON.stringify(result).includes('example-token-value'));
});

test('release listing and CLI-compatible v2 logs resolve and confirm the exact release ID', async () => {
  const releases = await fixture('releases.json');
  const logs = await fixture('release-logs.json');
  const requests = [];
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', teamId: 'team-42', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const path = new URL(url).pathname;
    return { ok: true, status: 200, json: async () => path.endsWith('/releases') ? releases : logs };
  } });
  const listed = await adapter.getReleases('sanitized-demo-app');
  assert.equal(listed.data.currentReleaseId, 'release-22');
  assert.deepEqual(listed.data.releases.map(({id,tag,state,current}) => ({id,tag,state,current})), [
    { id: 'release-22', tag: 'v22', state: 'READY', current: true },
    { id: 'release-21', tag: 'v21', state: 'FAILED', current: false },
  ]);
  assert.ok(!JSON.stringify(listed).includes('private@example.test'));
  const result = await adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: '1792570000' });
  assert.equal(result.correlation, 'CONFIRMED');
  assert.equal(result.releaseLogAttribution, 'CONFIRMED');
  assert.deepEqual(result.startupFailure, { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' });
  assert.equal(result.sourceToReleaseCorrespondence, 'UNCONFIRMED');
  assert.equal(result.release.id, 'release-21');
  assert.deepEqual(result.signals, ['MODULE_NOT_FOUND']);
  assert.equal(result.logs[0].releaseId, 'release-21');
  assert.ok(JSON.stringify(result).includes('"entrypoint":"missing.mjs"'));
  assert.ok(!JSON.stringify(result).includes('/app/'));
  assert.equal(requests.length, 3);
  const releaseUrl = new URL(requests[0].url);
  assert.equal(releaseUrl.pathname, '/v1/projects/sanitized-demo-app/releases');
  assert.equal(releaseUrl.searchParams.get('page'), '1');
  assert.equal(releaseUrl.searchParams.get('count'), '100');
  const logsUrl = new URL(requests[2].url);
  assert.equal(logsUrl.pathname, '/v2/projects/sanitized-demo-app/logs');
  assert.equal(logsUrl.searchParams.get('start'), '1792570000');
  assert.equal(logsUrl.searchParams.get('releaseId'), 'release-21');
  assert.equal(logsUrl.searchParams.get('teamID'), 'team-42');
  assert.deepEqual(requests.map(request => request.options.method), ['GET', 'GET', 'GET']);
});

test('missing release metadata leaves attribution unconfirmed and raw message hidden', async () => {
  const releases = await fixture('releases.json');
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async url => ({
    ok: true, status: 200,
    json: async () => new URL(url).pathname.endsWith('/releases') ? releases : { data: [{ metaData: {}, values: [['1792573200', '{"_entry":"Cannot find module /private/customer/path","type":"stderr"}']] }] },
  }) });
  const result = await adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: 1792570000 });
  assert.equal(result.correlation, 'UNCONFIRMED');
  assert.equal(result.logs[0].releaseId, null);
  assert.deepEqual(result.signals, ['MODULE_NOT_FOUND']);
  assert.ok(!JSON.stringify(result).includes('/private/customer/path'));
});

test('empty release-filtered logs never confirm correlation', async () => {
  const releases = await fixture('releases.json');
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async url => ({
    ok: true, status: 200,
    json: async () => new URL(url).pathname.endsWith('/releases') ? releases : { data: [] },
  }) });
  const result = await adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: 1792570000 });
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.correlation, 'UNCONFIRMED');
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.signals, []);
});

test('startup evidence exposes only the supported entrypoint and keeps local source correspondence unconfirmed', async () => {
  const releases = await fixture('releases.json');
  const logs = { data: [{ metaData: { releaseId: 'release-21' }, values: [[1792573200, JSON.stringify({ _entry: "Error: Cannot find module '/app/missing.mjs'; token=secret-value; env=PRIVATE_VALUE" })]] }] };
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async url => ({ ok: true, status: 200, json: async () => new URL(url).pathname.endsWith('/releases') ? releases : logs }) });
  const result = await adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: 1792570000, until: 1792574000 });
  assert.deepEqual(result.startupFailure, { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' });
  assert.equal(result.releaseLogAttribution, 'CONFIRMED');
  assert.equal(result.sourceToReleaseCorrespondence, 'UNCONFIRMED');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('/app/'));
  assert.ok(!serialized.includes('secret-value'));
  assert.ok(!serialized.includes('PRIVATE_VALUE'));
});

test('unrelated imported dependency is not reported as the missing startup entrypoint', async () => {
  const releases = await fixture('releases.json');
  const logs = { data: [{ metaData: { releaseId: 'release-21' }, values: [[1792573200, JSON.stringify({ _entry: "Error: Cannot find module '/app/node_modules/left-pad/index.js'" })]] }] };
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async url => ({ ok: true, status: 200, json: async () => new URL(url).pathname.endsWith('/releases') ? releases : logs }) });
  const result = await adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: 1792570000, until: 1792574000 });
  assert.equal(result.releaseLogAttribution, 'CONFIRMED');
  assert.deepEqual(result.startupFailure, { status: 'UNCONFIRMED', code: null, entrypoint: null });
  assert.equal(result.logs[0].missingEntrypoint, null);
  assert.ok(!JSON.stringify(result).includes('left-pad'));
});

test('selected release log evidence is bounded to the selected six-hour time range', async () => {
  const releases = await fixture('releases.json');
  const logs = { data: [{ metaData: { releaseId: 'release-21' }, values: [[1792573200, 'entry in range'], [1792599999, 'entry after range']] }] };
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async url => ({ ok: true, status: 200, json: async () => new URL(url).pathname.endsWith('/releases') ? releases : logs }) });
  const result = await adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: 1792570000, until: 1792574000 });
  assert.equal(result.logs.length, 1);
  assert.equal(result.correlation, 'CONFIRMED');
  await assert.rejects(() => adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: 1792570000, until: 1792592001 }), /six hours/i);
});

test('release log nanosecond timestamps are converted to seconds for bounded filtering', async () => {
  const releases = await fixture('releases.json');
  const nanos = '1792573200123456789';
  const logs = { data: [{ metaData: { releaseId: 'release-21' }, values: [[nanos, JSON.stringify({ _entry: "Error: Cannot find module '/app/missing.mjs'" })]] }] };
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async url => ({ ok: true, status: 200, json: async () => new URL(url).pathname.endsWith('/releases') ? releases : logs }) });
  const result = await adapter.getReleaseLogs('sanitized-demo-app', { releaseTag: 'v21', since: '1792573200', until: '1792573201' });
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.correlation, 'CONFIRMED');
  assert.equal(result.startupFailure.status, 'CONFIRMED');
  assert.equal(result.logs[0].timestamp, nanos);
});

test('adapter requires since, validates team/project names, and fails closed on API errors', async () => {
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(() => adapter.getLogs('app', ''), /since/i);
  await assert.rejects(() => adapter.getProject('../other'), /project name/i);
  assert.throws(() => new LiaraReadOnlyAdapter({ token: 'test-secret', teamId: 'bad/team' }), /team ID/i);
  assert.deepEqual(await adapter.getProject('app'), { status: 'UNAVAILABLE', httpStatus: 403, data: null });
  const timedOut = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async () => { throw new Error('network'); } });
  assert.deepEqual(await timedOut.getProject('app'), { status: 'UNKNOWN', httpStatus: null, data: null });
});

test('adapter aborts a slow request at its configured timeout and reports UNKNOWN', async () => {
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    if (signal.aborted) reject(new Error('aborted'));
  }) });
  assert.deepEqual(await adapter.getProject('sanitized-demo-app'), { status: 'UNKNOWN', httpStatus: null, data: null });
});

test('project identity mismatch and malformed project response fail closed as UNKNOWN', async () => {
  for (const body of [{ project: { project_id: 'some-other-app' } }, { project: { status: 'RUNNING' } }]) {
    const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }) });
    assert.deepEqual(await adapter.getProject('sanitized-demo-app'), { status: 'UNKNOWN', httpStatus: 200, data: null });
  }
});

test('adapter bounds response bytes and validates timeout and size limits', async () => {
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', maxResponseBytes: 8, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"project":{}}' }) });
  assert.deepEqual(await adapter.getProject('sanitized-demo-app'), { status: 'UNKNOWN', httpStatus: 200, data: null });
  assert.throws(() => new LiaraReadOnlyAdapter({ token: 'test-secret', timeoutMs: 0 }), /timeoutMs/i);
  assert.throws(() => new LiaraReadOnlyAdapter({ token: 'test-secret', timeoutMs: 60_001 }), /timeoutMs/i);
  assert.throws(() => new LiaraReadOnlyAdapter({ token: 'test-secret', maxResponseBytes: 0 }), /maxResponseBytes/i);
});

test('provider HTTP errors expose a sanitized code only and never body messages or secrets', async () => {
  const adapter = new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { code: 'ACCESS_DENIED', message: 'Bearer test-secret private@example.test' } }) }) });
  const result = await adapter.getReleases('sanitized-demo-app');
  assert.deepEqual(result, { status: 'UNAVAILABLE', httpStatus: 403, error: { code: 'ACCESS_DENIED' }, data: null });
  assert.ok(!JSON.stringify(result).includes('test-secret'));
  assert.ok(!JSON.stringify(result).includes('private@example.test'));
});

test('duplicate release tags are UNKNOWN rather than selecting arbitrary provenance', async () => {
  const result = await new LiaraReadOnlyAdapter({ token: 'test-secret', fetchImpl: async () => ({
    ok: true, status: 200,
    json: async () => ({ currentRelease: 'r1', releases: [{ _id: 'r1', tag: 'same' }, { _id: 'r2', tag: 'SAME' }] }),
  }) }).getReleaseLogs('app', { releaseTag: 'same', since: 1792570000 });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.correlation, 'UNCONFIRMED');
  assert.equal(result.release, null);
});
