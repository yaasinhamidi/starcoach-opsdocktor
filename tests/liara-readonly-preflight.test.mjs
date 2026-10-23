import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectReadOnlyPreflight, inspectReadOnlyConfig, loadAuthorizedReadOnlyConfig } from '../src/liara-readonly-preflight.mjs';

test('preflight stays unavailable without owner authorization and does not read config or create an adapter', async () => {
  let reads = 0; let adapters = 0;
  const config = await loadAuthorizedReadOnlyConfig({
    repoRoot: 'C:\\liara-test', env: { LIARA_READONLY_TOKEN: 'test-only' },
    readFileImpl: async () => { reads++; throw new Error('should not read'); },
    adapterFactory: () => { adapters++; throw new Error('should not instantiate'); },
  });
  const result = await collectReadOnlyPreflight(config);
  assert.equal(result.mode, 'UNAVAILABLE');
  assert.equal(reads, 0);
  assert.equal(adapters, 0);
});

test('authorized local configuration creates bounded GET-only evidence without binding source identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liara-readonly-config-'));
  try {
    await writeFile(join(root, '.liara-readonly.json'), JSON.stringify({
      ownerAuthorized: true, teamId: 'team-42', projectName: 'sanitized-demo-app', releaseTag: 'v21',
      since: 1792570000, until: 1792574000,
    }));
    const calls = [];
    const config = await loadAuthorizedReadOnlyConfig({
      repoRoot: root,
      env: { LIARA_READONLY_OWNER_AUTHORIZED: 'YES', LIARA_READONLY_TOKEN: 'test-secret-never-output' },
      nowSeconds: () => 1792580000,
      adapterFactory: ({ token, teamId }) => {
        assert.equal(token, 'test-secret-never-output');
        assert.equal(teamId, 'team-42');
        return {
          async getProject(name) { calls.push(['project', name]); return { status: 'AVAILABLE', data: { id: 'project-1', name } }; },
          async getReleases(name, page) { calls.push(['releases', name, page]); return { status: 'AVAILABLE', data: { currentReleaseId: 'release-22', releases: [{ id: 'release-21', tag: 'v21', current: false }] } }; },
          async getReleaseLogs(name, options) {
            calls.push(['logs', name, options]);
            return { status: 'AVAILABLE', release: { id: 'release-21', tag: 'v21' }, correlation: 'CONFIRMED', startupFailure: { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' }, logs: [{ timestamp: '1792573200', releaseId: 'release-21', signals: ['MODULE_NOT_FOUND'], missingEntrypoint: 'missing.mjs' }], signals: ['MODULE_NOT_FOUND'] };
          },
        };
      },
    });
    assert.equal(config.status, 'READY');
    const evidence = await collectReadOnlyPreflight(config);
    assert.equal(evidence.mode, 'LIVE READ-ONLY');
    assert.equal(evidence.logEvidence.releaseLogAttribution, 'CONFIRMED');
    assert.deepEqual(evidence.logEvidence.startupFailureIdentification, { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' });
    assert.equal(evidence.sourceToReleaseCorrespondence, 'UNCONFIRMED');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2][2], { releaseTag: 'v21', since: 1792570000, until: 1792574000, lastLines: true, releases: { currentReleaseId: 'release-22', releases: [{ id: 'release-21', tag: 'v21', current: false }] } });
    assert.ok(!JSON.stringify(evidence).includes('test-secret-never-output'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight rejects a selected time range longer than six hours before adapter creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liara-readonly-window-'));
  try {
    await writeFile(join(root, '.liara-readonly.json'), JSON.stringify({
      ownerAuthorized: true, teamId: 'team-42', projectName: 'sanitized-demo-app', releaseTag: 'v21',
      since: 1792570000, until: 1792592001,
    }));
    let adapters = 0;
    const config = await loadAuthorizedReadOnlyConfig({ repoRoot: root, env: { LIARA_READONLY_OWNER_AUTHORIZED: 'YES', LIARA_READONLY_TOKEN: 'test-secret' }, nowSeconds: () => 1792600000, adapterFactory: () => { adapters++; return {}; } });
    assert.equal(config.status, 'UNAVAILABLE');
    assert.equal(adapters, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('offline config inspection validates selectors and time range without environment credentials or adapter creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liara-readonly-offline-check-'));
  try {
    await writeFile(join(root, '.liara-readonly.json'), JSON.stringify({
      ownerAuthorized: false, teamId: 'team-42', projectName: 'sanitized-demo-app', releaseTag: 'v21',
      since: 1792570000, until: 1792574000,
    }));
    const result = await inspectReadOnlyConfig({ repoRoot: root, nowSeconds: () => 1792580000 });
    assert.equal(result.status, 'CONFIG_VALID');
    assert.equal(result.ownerAuthorized, false);
    assert.equal(result.until - result.since, 4000);
    assert.ok(!JSON.stringify(result).includes('token'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('offline config inspection rejects invalid selectors and oversized windows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liara-readonly-offline-invalid-'));
  try {
    const path = join(root, '.liara-readonly.json');
    await writeFile(path, JSON.stringify({ teamId: 'bad/team', projectName: 'app', releaseTag: 'v1', since: 1792570000, until: 1792570001 }));
    assert.equal((await inspectReadOnlyConfig({ repoRoot: root })).status, 'INVALID');
    await writeFile(path, JSON.stringify({ teamId: 'team', projectName: 'app', releaseTag: 'v1', since: 1792570000, until: 1792592001 }));
    assert.equal((await inspectReadOnlyConfig({ repoRoot: root, nowSeconds: () => 1792600000 })).status, 'INVALID');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('offline config inspection rejects the shipped example placeholders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liara-readonly-example-check-'));
  try {
    const example = JSON.parse(await readFile(new URL('../.liara-readonly.example.json', import.meta.url), 'utf8'));
    await writeFile(join(root, '.liara-readonly.json'), JSON.stringify(example));
    const result = await inspectReadOnlyConfig({ repoRoot: root });
    assert.equal(result.status, 'INVALID');
    assert.match(result.reason, /selections/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
