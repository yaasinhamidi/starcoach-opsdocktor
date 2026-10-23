import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputName = `submission-package-offline-${randomUUID()}`;
const isolatedRoot = await mkdtemp(join(resolve(process.argv[2] ?? tmpdir()), 'liara-packaging-offline-'));
const packageRoot = join(isolatedRoot, 'package');
const cacheRoot = join(isolatedRoot, 'empty-npm-cache');
const userConfig = join(isolatedRoot, 'empty-user.npmrc');
const globalConfig = join(isolatedRoot, 'empty-global.npmrc');
const tarball = 'vendor/starcoach-core-llm-0.5.0.tgz';
const digest = async path => createHash('sha512').update(await readFile(path)).digest('base64');
const originalDigest = await digest(join(repoRoot, tarball));

// Never inherit provider credentials, npm configuration, or Node preload options.
const env = {
  PATH: dirname(process.execPath), HOME: isolatedRoot, USERPROFILE: isolatedRoot,
  TEMP: isolatedRoot, TMP: isolatedRoot,
  ...(process.platform === 'win32' ? { SystemRoot: 'C:\\Windows' } : {}),
};
const run = async (args, cwd = packageRoot) => {
  const result = await exec(process.execPath, args, { cwd, env, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
};

process.stdout.write(`Curated output: ${join(repoRoot, outputName)}\nIsolated package: ${packageRoot}\n`);
await run(['scripts/package-submission.mjs', outputName], repoRoot);
await cp(join(repoRoot, outputName), packageRoot, { recursive: true, force: false, errorOnExist: true });
assert.ok(!(await readdir(packageRoot)).includes('node_modules'));
await mkdir(cacheRoot);
assert.deepEqual(await readdir(cacheRoot), []);
await writeFile(userConfig, '', { flag: 'wx' });
await writeFile(globalConfig, '', { flag: 'wx' });
const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await run([npmCli, '--version']);
const ciArgs = [npmCli, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cacheRoot, '--userconfig', userConfig, '--globalconfig', globalConfig];
process.stdout.write(`Install: node ${ciArgs.join(' ')}\n`);
await run(ciArgs);
const sdk = JSON.parse(await readFile(join(packageRoot, 'node_modules/@starcoach/core-llm/package.json'), 'utf8'));
assert.equal(sdk.name, '@starcoach/core-llm');
assert.equal(sdk.version, '0.5.0');
assert.equal(await digest(join(packageRoot, tarball)), originalDigest);
assert.deepEqual(await readFile(join(packageRoot, 'package-lock.json')), await readFile(join(repoRoot, 'package-lock.json')));
const tests = (await readdir(join(packageRoot, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort();
await run(['--test', ...tests.map(name => `tests/${name}`)]);
await run(['scripts/smoke.mjs']);

// Import only the independently installed package and explicitly bypass real env configuration.
const { createDemoServer } = await import(pathToFileURL(join(packageRoot, 'src/demo-server.mjs')));
const { createDiagnosisProviderFromEnv } = await import(pathToFileURL(join(packageRoot, 'src/diagnosis-providers.mjs')));
const { server } = await createDemoServer({ diagnosisProvider: createDiagnosisProviderFromEnv({}) });
try {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /REPLAY/);
  const stateResponse = await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(5000) });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.mode, 'REPLAY + MOCK');
  const statusResponse = await fetch(`${origin}/api/llm-status`, { signal: AbortSignal.timeout(5000) });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.provider, 'offline');
  assert.equal(await digest(join(repoRoot, tarball)), originalDigest);
  process.stdout.write(`${JSON.stringify({ packageRoot, curatedOutput: join(repoRoot, outputName), sdk: `${sdk.name}@${sdk.version}`, integrity: `sha512-${originalDigest}`, startup: { origin, pageHttp: page.status, stateHttp: stateResponse.status, mode: state.mode, provider: status.provider }, sdkArtifactUnchanged: true }, null, 2)}\n`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
process.stdout.write('All generated package and npm validation directories were retained; no preexisting output was removed.\n');
