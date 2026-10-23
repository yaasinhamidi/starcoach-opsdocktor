import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_ARTIFACT_VERSION = 'liara-recovery-v1';
const TRUSTED_SERVER_SHA256 = '025db3cdadf3195891e7810a27044ca37ac916f58306f38563c8d9a576dfcc7b';
const TRUSTED_PORT_SERVER_SHA256 = 'fead7deb0b507b363202050c370bc281f0b4d1fcab7846b433307012b8313a23';
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoots = new Map([
  ['startup-missing', join(repoRoot, 'fixtures', 'recovery-node-app')],
  ['port-config-mismatch', join(repoRoot, 'fixtures', 'port-mismatch-node-app')],
]);

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Creates a fresh, isolated copy of only the two trusted demo files. */
export async function createTrustedRecoveryWorkspace({ incidentScenario = 'startup-missing' } = {}) {
  const fixtureRoot = fixtureRoots.get(incidentScenario);
  if (!fixtureRoot) throw new TypeError('Unsupported trusted recovery fixture');
  const tempRoot = await mkdtemp(join(tmpdir(), 'liara-recovery-demo-'));
  const appRoot = join(tempRoot, 'app');
  try {
    await mkdir(appRoot);
    const fileNames = incidentScenario === 'port-config-mismatch' ? ['package.json', 'liara.json', 'server.mjs'] : ['package.json', 'server.mjs'];
    for (const name of fileNames) {
      const source = join(fixtureRoot, name);
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Trusted recovery fixture is not a regular file');
      const expectedHash = incidentScenario === 'port-config-mismatch' ? TRUSTED_PORT_SERVER_SHA256 : TRUSTED_SERVER_SHA256;
      if (name === 'server.mjs' && sha(await readFile(source)) !== expectedHash) {
        throw new Error('Trusted demo server artifact fingerprint does not match');
      }
      await copyFile(source, join(appRoot, name));
    }
    return { root: tempRoot, appRoot, cleanup: () => rm(tempRoot, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Runs only the fingerprinted demo server, never npm or a package script. */
export async function verifyTrustedLocalHealth(appRoot, { timeoutMs = 2500 } = {}) {
  const packageFile = join(appRoot, 'package.json');
  const serverFile = join(appRoot, 'server.mjs');
  let contractInfo = null;
  try { contractInfo = await lstat(join(appRoot, 'liara.json')); } catch (error) { if (error.code !== 'ENOENT') return { source: 'LOCAL_HTTP', status: 'FAILED', reason: 'Deployment contract metadata could not be inspected.' }; }
  const [pkgInfo, serverInfo] = await Promise.all([lstat(packageFile), lstat(serverFile)]);
  if (!pkgInfo.isFile() || pkgInfo.isSymbolicLink() || pkgInfo.size > 64 * 1024
    || !serverInfo.isFile() || serverInfo.isSymbolicLink()
    || (contractInfo && (!contractInfo.isFile() || contractInfo.isSymbolicLink() || contractInfo.size > 64 * 1024))) {
    return { source: 'LOCAL_HTTP', status: 'FAILED', reason: 'Demo artifact files failed the bounded regular-file check.' };
  }
  let pkg;
  try { pkg = JSON.parse(await readFile(packageFile, 'utf8')); }
  catch { return { source: 'LOCAL_HTTP', status: 'FAILED', reason: 'Demo package metadata is invalid.' }; }
  const hasPortContract = Boolean(contractInfo);
  let liara = null;
  if (hasPortContract) {
    try { liara = JSON.parse(await readFile(join(appRoot, 'liara.json'), 'utf8')); }
    catch { return { source: 'LOCAL_HTTP', status: 'FAILED', reason: 'Deployment contract metadata is invalid.' }; }
  }
  const expectedPackageKeys = hasPortContract ? ['config', 'name', 'private', 'scripts', 'type'] : ['name', 'private', 'scripts', 'type'];
  const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535;
  const expectedServerHash = hasPortContract ? TRUSTED_PORT_SERVER_SHA256 : TRUSTED_SERVER_SHA256;
  if (pkg?.scripts?.start !== 'node server.mjs' || pkg?.private !== true || pkg?.type !== 'module'
    || !['liara-recovery-demo', 'liara-port-contract-demo'].includes(pkg?.name)
    || Object.keys(pkg).sort().join(',') !== expectedPackageKeys.sort().join(',')
    || (hasPortContract && (!validPort(pkg?.config?.port) || Object.keys(pkg.config).join(',') !== 'port'
      || !validPort(liara?.port) || Object.keys(liara).join(',') !== 'port'))
    || (hasPortContract && pkg?.name !== 'liara-port-contract-demo')
    || (!hasPortContract && pkg?.name !== 'liara-recovery-demo')
    || sha(await readFile(serverFile)) !== expectedServerHash) {
    return { source: 'LOCAL_HTTP', status: 'FAILED', reason: 'Only the approved, fingerprinted dependency-free demo artifact may run.' };
  }

  const configurationAgreement = hasPortContract
    ? { status: pkg.config.port === liara.port ? 'VERIFIED' : 'MISMATCH', applicationPort: pkg.config.port, deploymentPort: liara.port }
    : { status: 'NOT_APPLICABLE' };
  let applicationPort = hasPortContract ? pkg.config.port : null;
  const deploymentPort = hasPortContract ? liara.port : null;
  if (!hasPortContract) {
    const portServer = await import('node:net').then(({ createServer }) => createServer());
    await new Promise((resolve, reject) => portServer.once('error', reject).listen(0, '127.0.0.1', resolve));
    applicationPort = portServer.address().port;
    await new Promise(resolve => portServer.close(resolve));
  } else {
    // A mismatch is useful only if both the configured and requested contract ports are free.
    // Never choose another port or terminate an unrelated listener.
    for (const port of new Set([applicationPort, deploymentPort])) {
      const probe = await import('node:net').then(({ createServer }) => createServer());
      try {
        await new Promise((resolve, reject) => {
          probe.once('error', reject);
          probe.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
        });
      } catch {
        return { source: 'LOCAL_HTTP', status: 'UNKNOWN', configurationAgreement,
          genericFixtureLiveness: { status: 'NOT_RUN' },
          portContractRuntime: { status: 'UNKNOWN', reason: 'A configured verification port is occupied or could not be safely reserved.' } };
      } finally {
        if (probe.listening) await new Promise(resolve => probe.close(resolve));
      }
    }
  }
  const childEnv = {};
  if (!hasPortContract) childEnv.PORT = String(applicationPort);
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) childEnv[key] = process.env[key];
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appRoot, env: childEnv, stdio: 'ignore', windowsHide: true });
  let childFailed = false;
  child.once('error', () => { childFailed = true; });
  child.once('exit', code => { if (code !== null && code !== 0) childFailed = true; });
  const stopAt = Date.now() + timeoutMs;
  let genericFixtureLiveness = { status: 'PENDING' };
  let portContractRuntime = { status: hasPortContract ? 'PENDING' : 'NOT_APPLICABLE' };
  try {
    while (Date.now() < stopAt) {
      if (childFailed || child.exitCode !== null) {
        return { source: 'LOCAL_HTTP', status: hasPortContract ? 'UNKNOWN' : 'FAILED', configurationAgreement,
          genericFixtureLiveness: { status: 'FAILED', reason: 'Trusted demo server exited before becoming healthy.' },
          portContractRuntime: hasPortContract ? { status: 'UNKNOWN', reason: 'The fixture process exited before contract verification.' } : { status: 'NOT_APPLICABLE' },
          expectedVersion: EXPECTED_ARTIFACT_VERSION };
      }
      const healthAt = async port => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(200) });
          if (response.status !== 200) return null;
          const body = await response.json();
          return body?.status === 'ok' && body.version === EXPECTED_ARTIFACT_VERSION ? body.version : null;
        } catch { return null; }
      };
      const observedApplicationVersion = await healthAt(applicationPort);
      if (observedApplicationVersion) {
        genericFixtureLiveness = { status: 'VERIFIED', port: applicationPort, httpStatus: 200, path: '/healthz', observedVersion: observedApplicationVersion };
      }
      if (hasPortContract) {
        const observedContractVersion = await healthAt(deploymentPort);
        if (observedContractVersion) {
          portContractRuntime = { status: 'VERIFIED', port: deploymentPort, httpStatus: 200, path: '/healthz', observedVersion: observedContractVersion };
          return { source: 'LOCAL_HTTP', status: configurationAgreement.status === 'VERIFIED' ? 'VERIFIED' : 'NOT_VERIFIED',
            configurationAgreement, genericFixtureLiveness,
            portContractRuntime: configurationAgreement.status === 'VERIFIED' ? portContractRuntime
              : { ...portContractRuntime, status: 'NOT_VERIFIED', reason: 'The endpoint responded, but the application and deployment port configuration disagree.' },
            ...(configurationAgreement.status === 'VERIFIED' ? { httpStatus: 200, path: '/healthz', expectedVersion: EXPECTED_ARTIFACT_VERSION, observedVersion: observedContractVersion } : {}) };
        }
      } else if (observedApplicationVersion) {
        return { source: 'LOCAL_HTTP', status: 'VERIFIED', configurationAgreement,
          genericFixtureLiveness, portContractRuntime, httpStatus: 200, path: '/healthz',
          expectedVersion: EXPECTED_ARTIFACT_VERSION, observedVersion: observedApplicationVersion };
      }
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    if (hasPortContract && genericFixtureLiveness.status === 'VERIFIED' && configurationAgreement.status === 'MISMATCH') {
      return { source: 'LOCAL_HTTP', status: 'NOT_VERIFIED', configurationAgreement, genericFixtureLiveness,
        portContractRuntime: { status: 'NOT_VERIFIED', expectedEndpointFailure: true,
          reason: 'The fixture was live on its configured application port, while the declared deployment port did not serve /healthz.' } };
    }
    return { source: 'LOCAL_HTTP', status: 'UNKNOWN', configurationAgreement, genericFixtureLiveness,
      portContractRuntime: hasPortContract ? { ...portContractRuntime, status: 'UNKNOWN', reason: 'Contract endpoint did not respond before the bounded deadline.' } : portContractRuntime,
      reason: 'Local health endpoint did not respond before the bounded deadline.', expectedVersion: EXPECTED_ARTIFACT_VERSION };
  } finally {
    child.kill();
    await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 500))]);
  }
}
