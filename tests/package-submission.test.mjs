import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { verifySourcePackage } from '../scripts/verify-source-package.mjs';

const exec = promisify(execFile);
const coreTarball = 'vendor/starcoach-core-llm-0.5.0.tgz';
const coreDependency = `file:${coreTarball}`;

test('real source allowlist contains unique paths in sorted order', async () => {
  const allowlist = JSON.parse(await readFile(new URL('../scripts/package-allowlist.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(allowlist));
  assert.ok(allowlist.every(path => typeof path === 'string'));
  assert.equal(new Set(allowlist).size, allowlist.length);
  assert.deepEqual(allowlist, [...allowlist].sort());
});

const packageFiles = [
  'README.md', 'package.json', 'package-lock.json', coreTarball, '.env.example', '.liara-readonly.example.json',
  'assets/fonts/Vazirmatn-Variable.woff2', 'assets/fonts/OFL.txt', 'docs/INSTALLATION.md', 'docs/ARCHITECTURE.md',
  'docs/CODING_AGENT_HANDOFF.md', 'src/synthetic.mjs', 'tests/synthetic.test.mjs', 'fixtures/recovery-evidence/synthetic.json',
  'scripts/package-submission.mjs', 'scripts/verify-source-package.mjs', 'scripts/package-allowlist.json',
];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'liara-packaging-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, content) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, { flag: 'wx' });
  };
  const tarball = Buffer.from('synthetic SDK bytes for packaging tests, never executed');
  const pkg = { dependencies: { '@starcoach/core-llm': coreDependency } };
  const lock = { lockfileVersion: 3, packages: {
    '': { dependencies: { ...pkg.dependencies } },
    'node_modules/@starcoach/core-llm': { version: '0.5.0', resolved: coreDependency,
      integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}` },
  } };
  for (const path of packageFiles.filter(path => !path.endsWith('.tgz') && !['package.json', 'package-lock.json', 'scripts/package-allowlist.json', 'scripts/package-submission.mjs', 'scripts/verify-source-package.mjs'].includes(path))) {
    await put(path, path === 'README.md' ? '# Test package\n' : 'synthetic test placeholder\n');
  }
  await put('package.json', JSON.stringify(pkg));
  await put('package-lock.json', JSON.stringify(lock));
  await put(coreTarball, tarball);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await copyFile(new URL('../scripts/package-submission.mjs', import.meta.url), join(root, 'scripts/package-submission.mjs'));
  await copyFile(new URL('../scripts/verify-source-package.mjs', import.meta.url), join(root, 'scripts/verify-source-package.mjs'));
  await put('scripts/package-allowlist.json', `${JSON.stringify([...packageFiles].sort(), null, 2)}\n`);
  const run = (name = 'submission-package-test') => exec(process.execPath, ['scripts/package-submission.mjs', name], { cwd: root });
  return { root, pkg, lock, tarball, run, put };
}

test('curated package is exactly allowlisted and its sorted size/hash manifest verifies', async t => {
  const { root, tarball, run } = await fixture(t);
  const { stdout } = await run();
  const output = join(root, 'submission-package-test');
  const verification = await verifySourcePackage(output);
  assert.equal(verification.files, packageFiles.length);
  assert.match(stdout, /CONTENT_MANIFEST\.json SHA-256 [a-f0-9]{64}/);
  assert.deepEqual(await readFile(join(output, coreTarball)), tarball);
  const manifest = JSON.parse(await readFile(join(output, 'CONTENT_MANIFEST.json'), 'utf8'));
  assert.deepEqual(manifest.files.map(entry => entry.path), [...packageFiles].sort());
  assert.ok(manifest.files.every(entry => Number.isSafeInteger(entry.size) && /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.deepEqual((await readdir(output)).sort(), ['.env.example', '.liara-readonly.example.json', 'CONTENT_MANIFEST.json', 'README.md', 'assets', 'docs', 'fixtures', 'package-lock.json', 'package.json', 'scripts', 'src', 'tests', 'vendor'].sort());
  assert.equal((await readdir(join(output, 'vendor'))).join(','), 'starcoach-core-llm-0.5.0.tgz');
});

test('existing package is rejected without overwriting its manifest', async t => {
  const { root, run } = await fixture(t);
  await run();
  const manifestPath = join(root, 'submission-package-test', 'CONTENT_MANIFEST.json');
  const before = await readFile(manifestPath);
  await assert.rejects(run(), /Refusing to overwrite existing package directory/);
  assert.deepEqual(await readFile(manifestPath), before);
});

test('unsafe output names and missing allowlisted files are rejected before output creation', async t => {
  const { root, run } = await fixture(t);
  await assert.rejects(run('../submission-package-escape'), /safe submission-package directory name/);
  await rm(join(root, 'src/synthetic.mjs'));
  await assert.rejects(run(), /ENOENT|no such file/i);
  assert.ok(!(await readdir(root)).includes('submission-package-test'));
});

test('manifest verifier rejects tampered bytes, extra files and manifest-path changes', async t => {
  const { root, run, put } = await fixture(t);
  await run();
  const output = join(root, 'submission-package-test');
  await writeFile(join(output, 'src/synthetic.mjs'), 'changed after packaging\n');
  await assert.rejects(verifySourcePackage(output), /Manifest hash or size mismatch/);
  await writeFile(join(output, 'src/synthetic.mjs'), 'synthetic test placeholder\n');
  await put('submission-package-test/extra.txt', 'extra\n');
  await assert.rejects(verifySourcePackage(output), /exactly match/);
  await rm(join(output, 'extra.txt'));
  const manifestPath = join(output, 'CONTENT_MANIFEST.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[0].path = 'src/escape.mjs';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifySourcePackage(output), /Manifest paths do not match/);
});

test('source audit rejects a missing relative Markdown link and private allowlisted file', async t => {
  const { root, run } = await fixture(t);
  await writeFile(join(root, 'README.md'), '[missing](docs/not-in-package.md)\n');
  await assert.rejects(run(), /Missing or non-allowlisted Markdown link target/);
  await writeFile(join(root, 'README.md'), '# Test package\n');
  await writeFile(join(root, '.liara-readonly.json'), '{}');
  const allowlist = JSON.parse(await readFile(join(root, 'scripts/package-allowlist.json'), 'utf8'));
  allowlist.push('.liara-readonly.json');
  allowlist.sort();
  await writeFile(join(root, 'scripts/package-allowlist.json'), JSON.stringify(allowlist));
  await assert.rejects(run(), /Private file rejected/);
  assert.ok(!(await readdir(root)).includes('submission-package-test'));
});

test('source allowlist rejects duplicate paths, sibling dependencies, and symlinks', async t => {
  const { root, run } = await fixture(t);
  const allowlistPath = join(root, 'scripts/package-allowlist.json');
  const allowlist = JSON.parse(await readFile(allowlistPath, 'utf8'));
  await writeFile(allowlistPath, JSON.stringify([...allowlist, allowlist[0]].sort()));
  await assert.rejects(run(), /unique and sorted/);
  await writeFile(allowlistPath, JSON.stringify(allowlist));
  await writeFile(join(root, 'README.md'), 'External checkout: D:\\workspace\\apps\\other-app\\src\\index.mjs\n');
  await assert.rejects(run(), /Sibling application dependency/);
  await writeFile(join(root, 'README.md'), '# Test package\n');
  let linkError;
  try { await symlink('synthetic.mjs', join(root, 'src/link.mjs')); }
  catch (error) { linkError = error; }
  if (linkError?.code === 'EPERM') { t.skip('symlink creation is unavailable on this Windows host (EPERM)'); return; }
  if (linkError) throw linkError;
  allowlist.push('src/link.mjs');
  allowlist.sort();
  await writeFile(allowlistPath, JSON.stringify(allowlist));
  await assert.rejects(run(), /Symlink rejected/);
});

test('mismatched SDK lock metadata or tarball integrity is rejected before output', async t => {
  for (const field of ['dependency', 'version', 'resolved', 'integrity']) {
    await t.test(field, async t => {
      const { root, lock, run } = await fixture(t);
      if (field === 'dependency') lock.packages[''].dependencies['@starcoach/core-llm'] = 'file:vendor/other.tgz';
      else lock.packages['node_modules/@starcoach/core-llm'][field] = 'mismatch';
      await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
      await assert.rejects(run(), /does not match|do not match/);
      assert.ok(!(await readdir(root)).includes('submission-package-test'));
    });
  }
});
