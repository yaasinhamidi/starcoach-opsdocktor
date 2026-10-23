import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const variantsRoot = join(repoRoot, 'fixtures', 'liara-first-test-app', 'variants');
const variants = [
  { name: 'healthy-baseline', startCommand: 'node server.mjs', artifactVersion: 'liara-first-test-healthy-v1', expected: 'HEALTHY' },
  { name: 'intentional-startup-failure', startCommand: 'node missing.mjs', artifactVersion: 'liara-first-test-failure-v1', expected: 'STARTUP_FAILURE' },
  { name: 'corrected-startup', startCommand: 'node server.mjs', artifactVersion: 'liara-first-test-corrected-v1', expected: 'HEALTHY' },
];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function expectedManifest(variant, files) {
  const basis = { schemaVersion: 1, variant: variant.name, startCommand: variant.startCommand, artifactVersion: variant.artifactVersion, files };
  return { ...basis, artifactDigest: sha256(JSON.stringify(basis)) };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const port = server.address().port;
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

function childEnvironment(port) {
  const env = { PORT: String(port) };
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

async function checkStartFailure(directory) {
  const child = spawn(process.execPath, ['missing.mjs'], { cwd: directory, env: childEnvironment(0), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  const result = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Startup failure variant exceeded its local timeout')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolvePromise({ code, moduleNotFound: /Cannot find module|ERR_MODULE_NOT_FOUND/.test(stderr) }); });
  });
  assert.notEqual(result.code, 0, 'broken variant must exit nonzero');
  assert.equal(result.moduleNotFound, true, 'broken variant must report a missing entrypoint');
  return { result: 'PASS', expected: 'STARTUP_FAILURE', exitCode: result.code, category: 'MODULE_NOT_FOUND' };
}

async function checkHealthyServer(directory, expectedVersion) {
  const port = await reservePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: directory, env: childEnvironment(port), windowsHide: true, stdio: 'ignore' });
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Server exited before health verification');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(body, { status: 'ok', artifactVersion: expectedVersion });
        return { result: 'PASS', expected: 'HEALTHY', localHttp: 200, path: '/healthz', artifactVersion: body.artifactVersion };
      } catch (error) {
        if (error?.name === 'AssertionError') throw error;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
      }
    }
    throw new Error('Local health check timed out');
  } finally {
    child.kill();
    await Promise.race([new Promise(resolvePromise => child.once('close', resolvePromise)), new Promise(resolvePromise => setTimeout(resolvePromise, 500))]);
  }
}

const writeManifests = process.argv.includes('--write-manifests');
const results = [];
for (const variant of variants) {
  const directory = join(variantsRoot, variant.name);
  const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts?.start, variant.startCommand);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.dependencies, undefined);
  const liaraConfig = JSON.parse(await readFile(join(directory, 'liara.json'), 'utf8'));
  assert.deepEqual(liaraConfig, { port: 3000, node: { version: '22' } });
  const files = [];
  for (const path of ['liara.json', 'package.json', 'server.mjs']) {
    files.push({ path, sha256: sha256(await readFile(join(directory, path))) });
  }
  const expected = expectedManifest(variant, files);
  const manifestPath = join(directory, 'ARTIFACT_MANIFEST.json');
  if (writeManifests) await writeFile(manifestPath, json(expected), { flag: 'w' });
  const actual = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(actual, expected, `${variant.name} artifact manifest must match its source files`);
  const localCheck = variant.expected === 'HEALTHY'
    ? await checkHealthyServer(directory, variant.artifactVersion)
    : await checkStartFailure(directory);
  results.push({ variant: variant.name, artifactDigest: actual.artifactDigest, ...localCheck });
}

process.stdout.write(`${JSON.stringify({ mode: 'LOCAL_HTTP', externalRequests: 0, variants: results }, null, 2)}\n`);
