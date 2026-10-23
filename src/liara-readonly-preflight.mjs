import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiaraReadOnlyAdapter } from './liara-readonly.mjs';

const CONFIG_NAME = '.liara-readonly.json';
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_WINDOW_SECONDS = 6 * 60 * 60;

function unixSeconds(value, label) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  if (/^\d{1,12}$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be Unix seconds or an ISO timestamp`);
  return Math.floor(parsed / 1000);
}

export async function inspectReadOnlyConfig({ repoRoot, readFileImpl = readFile, nowSeconds = () => Math.floor(Date.now() / 1000) } = {}) {
  if (typeof repoRoot !== 'string') return { status: 'INVALID', reason: 'Local configuration location is unavailable.' };
  const configPath = join(repoRoot, CONFIG_NAME);
  let config;
  try {
    const info = await lstat(configPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES) return { status: 'INVALID', reason: 'Local read-only configuration is not a bounded regular file.' };
    config = JSON.parse(await readFileImpl(configPath, 'utf8'));
  } catch { return { status: 'INVALID', reason: 'Local read-only configuration is missing or invalid.' }; }
  if (typeof config?.teamId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(config.teamId)
      || typeof config.projectName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(config.projectName)
      || typeof config.releaseTag !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(config.releaseTag)
      || [config.teamId, config.projectName, config.releaseTag].some(value => /replace[-_ ]with|placeholder/i.test(value))) {
    return { status: 'INVALID', reason: 'Valid team, project, and release selections are required.' };
  }
  let since; let until;
  try { since = unixSeconds(config.since, 'since'); until = unixSeconds(config.until, 'until'); }
  catch { return { status: 'INVALID', reason: 'A bounded since/until time range is required.' }; }
  if (until < since || until - since > MAX_WINDOW_SECONDS || until > nowSeconds() + 300) return { status: 'INVALID', reason: 'The selected log window is invalid or exceeds six hours.' };
  return { status: 'CONFIG_VALID', ownerAuthorized: config.ownerAuthorized === true, teamId: config.teamId, projectName: config.projectName, releaseTag: config.releaseTag, since, until };
}

export async function loadAuthorizedReadOnlyConfig({ repoRoot, env = process.env, readFileImpl = readFile, adapterFactory = options => new LiaraReadOnlyAdapter(options), nowSeconds = () => Math.floor(Date.now() / 1000) } = {}) {
  if (env.LIARA_READONLY_OWNER_AUTHORIZED !== 'YES') {
    return { status: 'UNAVAILABLE', reason: 'Owner authorization gate is not enabled.' };
  }
  const local = await inspectReadOnlyConfig({ repoRoot, readFileImpl, nowSeconds });
  if (local.status !== 'CONFIG_VALID') return { status: 'UNAVAILABLE', reason: local.reason };
  if (!local.ownerAuthorized) return { status: 'UNAVAILABLE', reason: 'Local configuration does not record owner authorization.' };
  const token = env.LIARA_READONLY_TOKEN;
  if (typeof token !== 'string' || !token.trim()) return { status: 'UNAVAILABLE', reason: 'Scoped credential is unavailable in the local environment.' };
  try {
    const adapter = adapterFactory({ token, teamId: local.teamId });
    return { status: 'READY', adapter, projectName: local.projectName, releaseTag: local.releaseTag, since: local.since, until: local.until };
  } catch { return { status: 'UNAVAILABLE', reason: 'Read-only adapter configuration is invalid.' }; }
}

export async function collectReadOnlyPreflight(config) {
  if (config?.status !== 'READY') return { mode: 'UNAVAILABLE', status: 'UNAVAILABLE', reason: config?.reason ?? 'Owner authorization is required.', sourceToReleaseCorrespondence: 'UNCONFIRMED' };
  try {
    const project = await config.adapter.getProject(config.projectName);
    if (project.status !== 'AVAILABLE') return { mode: project.status === 'UNKNOWN' ? 'UNKNOWN' : 'UNAVAILABLE', status: project.status, project: null, releases: null, logEvidence: { status: project.status, releaseLogAttribution: 'UNCONFIRMED', startupFailureIdentification: { status: 'UNCONFIRMED', code: null, entrypoint: null }, logs: [], signals: [] }, sourceToReleaseCorrespondence: 'UNCONFIRMED' };
    const releases = await config.adapter.getReleases(config.projectName, { page: 1, count: 100 });
    const logs = releases.status === 'AVAILABLE'
      ? await config.adapter.getReleaseLogs(config.projectName, { releaseTag: config.releaseTag, since: config.since, until: config.until, lastLines: true, releases: releases.data })
      : { status: releases.status, correlation: 'UNCONFIRMED', releaseLogAttribution: 'UNCONFIRMED', startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null }, sourceToReleaseCorrespondence: 'UNCONFIRMED', release: null, logs: [], signals: [] };
    const statuses = [project.status, releases.status, logs.status];
    const status = statuses.includes('UNKNOWN') ? 'UNKNOWN' : statuses.every(value => value === 'AVAILABLE') ? 'AVAILABLE' : 'UNAVAILABLE';
    return {
      mode: status === 'AVAILABLE' ? 'LIVE READ-ONLY' : status,
      status,
      project: project.data,
      releases: releases.data,
      logEvidence: {
        selectedRelease: logs.release,
        timeRange: { since: config.since, until: config.until },
        status: logs.status,
        releaseLogAttribution: logs.releaseLogAttribution ?? logs.correlation ?? 'UNCONFIRMED',
        startupFailureIdentification: logs.startupFailure ?? { status: 'UNCONFIRMED', code: null, entrypoint: null },
        logs: logs.logs ?? [],
        signals: logs.signals ?? [],
      },
      sourceToReleaseCorrespondence: 'UNCONFIRMED',
      note: 'No local source snapshot is established as the source of this Liara release.',
    };
  } catch {
    return { mode: 'UNKNOWN', status: 'UNKNOWN', reason: 'Sanitized read-only preflight could not complete.', sourceToReleaseCorrespondence: 'UNCONFIRMED' };
  }
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.includes('--check')) {
    const result = await inspectReadOnlyConfig({ repoRoot });
    const summary = {
      mode: 'OFFLINE_CONFIG_CHECK',
      status: result.status,
      teamSelected: Boolean(result.teamId),
      projectSelected: Boolean(result.projectName),
      releaseSelected: Boolean(result.releaseTag),
      windowSeconds: result.status === 'CONFIG_VALID' ? result.until - result.since : null,
      ownerAuthorizationRecorded: result.status === 'CONFIG_VALID' && result.ownerAuthorized,
      credentialRead: false,
      apiRequests: 0,
      ...(result.status !== 'CONFIG_VALID' ? { reason: result.reason } : {}),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (result.status !== 'CONFIG_VALID') process.exitCode = 2;
    return;
  }
  const config = await loadAuthorizedReadOnlyConfig({ repoRoot });
  const result = await collectReadOnlyPreflight(config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'AVAILABLE') process.exitCode = 2;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) await main();
