import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockDeploymentProvider, planDigest } from '../src/mock-provider.mjs';
import { inspectRepository } from '../src/inspector.mjs';

async function withRepo(files, run) {
  const root = await mkdtemp(join(tmpdir(), 'liara-inspector-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(root, name, '..'), { recursive: true });
      await writeFile(join(root, name), content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function canonical(value, ignoreLegacyHash = false) {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => !(ignoreLegacyHash && k === 'hash')).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function expectedDigest(plan) {
  return createHash('sha256').update(canonical(plan, true)).digest('hex');
}

test('approval digest is derived from canonical plan content, not caller hash', () => {
  const provider = new MockDeploymentProvider();
  const plan = { action: 'deploy', version: 'v2', app: 'demo', hash: 'forged' };
  const approval = expectedDigest(plan);
  assert.match(approval, /^[a-f0-9]{64}$/);
  assert.throws(() => provider.deploy({ ...plan, version: 'v3' }, approval), /approval/i);
  assert.throws(() => provider.deploy({ ...plan, app: 'other' }, approval), /approval/i);
  assert.throws(() => provider.deploy({ version: 'v2', hash: 'caller-chosen' }, 'caller-chosen'), /approval/i);
  assert.throws(() => provider.deploy(plan, { digest: approval }), /approval/i);
  assert.throws(() => provider.deploy(plan, ''), /approval/i);
  assert.equal(provider.deploy({ hash: 'untrusted', app: 'demo', version: 'v2', action: 'deploy' }, approval).state, 'READY');
  const mutable = { action: 'deploy', version: 'v2' };
  const mutableApproval = planDigest(mutable);
  mutable.version = 'v3';
  assert.throws(() => provider.deploy(mutable, mutableApproval), /approval/i);
});

test('approval digest is stable across object key order and changes for nested action fields', () => {
  assert.equal(expectedDigest({ version: 'v2', action: 'deploy', options: { b: 2, a: 1 } }),
    expectedDigest({ options: { a: 1, b: 2 }, action: 'deploy', version: 'v2' }));
  assert.notEqual(expectedDigest({ version: 'v2', action: 'deploy', options: { a: 1 } }),
    expectedDigest({ version: 'v2', action: 'deploy', options: { a: 2 } }));
  assert.notEqual(expectedDigest({ version: 'v2', action: 'deploy', options: { hash: 'one' } }),
    expectedDigest({ version: 'v2', action: 'deploy', options: { hash: 'two' } }));
});

test('deploy executes only the immutable data snapshot covered by approval', () => {
  const provider = new MockDeploymentProvider();
  let versionReads = 0;
  const accessorPlan = { action: 'deploy' };
  Object.defineProperty(accessorPlan, 'version', {
    enumerable: true,
    get() { versionReads++; return versionReads === 1 ? 'v2' : 'UNAPPROVED-v3'; },
  });
  assert.throws(() => planDigest(accessorPlan), /unsupported|plain/i);
  assert.throws(() => provider.deploy(accessorPlan, '0'.repeat(64)), /approval/i);
  assert.equal(provider.currentRelease, 'stable-1');

  const changingProxy = new Proxy({ action: 'deploy', version: 'v2' }, {
    get(target, key, receiver) {
      if (key === 'version') return 'UNAPPROVED-v3';
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return descriptor;
    },
  });
  const approval = planDigest(changingProxy);
  const proxyResult = provider.deploy(changingProxy, approval);
  assert.equal(proxyResult.version, 'v2');
  assert.equal(provider.verifyCandidate(proxyResult, 'v2').ok, true);
  assert.equal(provider.verifyCandidate(proxyResult, 'UNAPPROVED-v3').ok, false);

  const approved = { action: 'deploy', version: 'v2' };
  const result = provider.deploy(approved, planDigest(approved));
  assert.equal(result.version, 'v2');
});

test('canonical action input rejects sparse arrays, extra array properties and accessors', () => {
  const sparse = { action: 'deploy', version: 'v2', options: Array(1) };
  const extra = { action: 'deploy', version: 'v2', options: [] };
  extra.options.hidden = 'ignored';
  const accessor = { action: 'deploy', version: 'v2' };
  Object.defineProperty(accessor, 'extra', { enumerable: true, get: () => 'ignored' });
  for (const plan of [sparse, extra, accessor]) {
    assert.throws(() => planDigest(plan), /unsupported|plain/i);
  }
});

test('invalid required package metadata is reported instead of returning clean findings', async () => {
  await withRepo({}, async root => {
    const findings = await inspectRepository(root);
    assert.ok(findings.some(f => f.code === 'PACKAGE_JSON_MISSING'));
  });
  const cases = [
    ['{bad json', 'PACKAGE_JSON_INVALID'],
    ['[]', 'PACKAGE_JSON_INVALID_STRUCTURE'],
    ['{"scripts":[]}', 'PACKAGE_SCRIPTS_INVALID'],
    ['{"scripts":{"start":7}}', 'PACKAGE_START_INVALID'],
  ];
  for (const [pkg, code] of cases) {
    await withRepo({ 'package.json': pkg }, async root => {
      const findings = await inspectRepository(root);
      assert.ok(findings.some(f => f.code === code), `expected ${code} for ${pkg}`);
    });
  }
});

test('missing optional Liara config is accepted, malformed and unsupported config is explicit', async () => {
  await withRepo({ 'package.json': '{"scripts":{"start":"node server.js"}}' }, async root => {
    assert.deepEqual(await inspectRepository(root), []);
  });
  const cases = [
    ['{bad json', 'LIARA_JSON_INVALID'],
    ['[]', 'LIARA_CONFIG_INVALID'],
    ['{}', 'LIARA_CONFIG_INVALID'],
    ['{"port":70000}', 'LIARA_PORT_INVALID'],
    ['{"unknownOption":true}', 'LIARA_CONFIG_UNSUPPORTED'],
  ];
  for (const [liara, code] of cases) {
    await withRepo({ 'package.json': '{"scripts":{"start":"node server.js"}}', 'liara.json': liara }, async root => {
      const findings = await inspectRepository(root);
      assert.ok(findings.some(f => f.code === code), `expected ${code} for ${liara}`);
    });
  }
});

test('unreadable required and optional config files are reported explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liara-unreadable-'));
  try {
    await mkdir(join(root, 'package.json'));
    assert.ok((await inspectRepository(root)).some(f => f.code === 'PACKAGE_JSON_UNREADABLE'));
    await rm(join(root, 'package.json'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"scripts":{"start":"node server.js"}}');
    await mkdir(join(root, 'liara.json'));
    assert.ok((await inspectRepository(root)).some(f => f.code === 'LIARA_JSON_UNREADABLE'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('metadata inspection rejects linked files outside the authorized root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'liara-linked-'));
  const outside = await mkdtemp(join(tmpdir(), 'liara-outside-'));
  try {
    await writeFile(join(outside, 'package.json'), '{"scripts":{"start":"secret"}}');
    try {
      await symlink(join(outside, 'package.json'), join(root, 'package.json'), 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`symlink unavailable: ${error.code}`);
      throw error;
    }
    const findings = await inspectRepository(root);
    assert.ok(findings.some(f => f.code === 'PACKAGE_JSON_UNREADABLE'));
    assert.ok(!findings.some(f => f.message?.includes('secret')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('metadata inspection rejects oversized configuration files', async () => {
  await withRepo({ 'package.json': `{"scripts":{"start":"${'x'.repeat(1024 * 1024)}"}}` }, async root => {
    const findings = await inspectRepository(root);
    assert.ok(findings.some(f => f.code === 'PACKAGE_JSON_UNREADABLE'));
  });
});

test('unsupported configuration evidence bounds and sanitizes keys without values', async () => {
  const hostileKey = `token\u0000\u001b${'x'.repeat(200)}`;
  await withRepo({
    'package.json': '{"scripts":{"start":"node server.js"}}',
    'liara.json': JSON.stringify({ port: 3000, [hostileKey]: 'TOP_SECRET_VALUE' }),
  }, async root => {
    const findings = await inspectRepository(root);
    const rendered = JSON.stringify(findings);
    assert.ok(rendered.length < 1000);
    assert.ok(!rendered.includes('\u0000') && !rendered.includes('\u001b'));
    assert.ok(!rendered.includes('TOP_SECRET_VALUE'));
    assert.ok(findings.some(f => f.code === 'LIARA_CONFIG_UNSUPPORTED'));
  });
});

test('mock verification distinguishes failed candidate from older healthy current release', () => {
  const provider = new MockDeploymentProvider({ candidateState: 'FAILED', activateCandidate: false });
  const plan = { action: 'deploy', version: 'v2' };
  const result = provider.deploy(plan, expectedDigest(plan));
  assert.equal(result.state, 'FAILED');
  assert.equal(result.current, false);
  assert.equal(provider.currentRelease, 'stable-1');
  assert.equal(provider.verifyCandidate('stable-1', 'stable').ok, true);
  assert.deepEqual(provider.verifyCandidate(result, 'v2'), {
    ok: false, candidateId: result.id, state: 'FAILED', current: false, version: 'v2',
  });
});

test('READY candidate must be current and must match candidate identity and expected version', () => {
  const provider = new MockDeploymentProvider({ activateCandidate: false });
  const plan = { action: 'deploy', version: 'v2' };
  const result = provider.deploy(plan, expectedDigest(plan));
  assert.equal(result.state, 'READY');
  assert.equal(provider.verifyCandidate(result, 'v2').ok, false);
  assert.equal(provider.verifyCandidate({ ...result, id: 'candidate-other' }, 'v2').ok, false);
  assert.equal(provider.verifyCandidate(result, 'v3').ok, false);
  const healthy = new MockDeploymentProvider();
  const active = healthy.deploy(plan, expectedDigest(plan));
  assert.equal(healthy.verifyCandidate(active, 'v2').ok, true);
});
