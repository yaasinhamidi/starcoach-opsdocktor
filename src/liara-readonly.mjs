import { parseStrictJson, requestLiaraReadOnly } from '@starcoach/core-llm';

function boundedText(value, max = 120) {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '').slice(0, max) : null;
}

function validateProjectName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name)) throw new TypeError('Invalid Liara project name');
}

function entryText(value) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?._entry === 'string' ? parsed._entry : '';
  } catch { return value; }
}

function signalsFrom(text) {
  const signals = [];
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(text)) signals.push('MODULE_NOT_FOUND');
  if (/ERR_MODULE_NOT_FOUND/i.test(text)) signals.push('ERR_MODULE_NOT_FOUND');
  if (/EADDRINUSE/i.test(text)) signals.push('EADDRINUSE');
  if (/SyntaxError/i.test(text)) signals.push('SYNTAX_ERROR');
  return signals;
}

function missingEntrypointFrom(text) {
  const match = text.match(/Cannot find module\s+['"]([^'"]+)['"]/i);
  if (!match) return null;
  const specifier = match[1].replace(/\\/g, '/');
  return ['/app/missing.mjs', './missing.mjs', 'missing.mjs'].includes(specifier) ? 'missing.mjs' : null;
}

function timeSeconds(value, label) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    if (value >= 1e18) return Math.floor(value / 1e9); // nanoseconds
    if (value >= 1e15) return Math.floor(value / 1e6); // microseconds
    if (value >= 1e12) return Math.floor(value / 1e3); // milliseconds
    return Math.floor(value); // seconds
  }
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be Unix seconds, milliseconds, microseconds, nanoseconds, or an ISO timestamp`);
  if (/^\d+$/.test(value)) {
    const digits = value.length;
    const scale = digits >= 19 ? 1_000_000_000n : digits >= 16 ? 1_000_000n : digits >= 13 ? 1_000n : 1n;
    const seconds = BigInt(value) / scale;
    const parsed = Number(seconds);
    if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} is outside the supported timestamp range`);
    return parsed;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be a supported Unix timestamp or an ISO timestamp`);
  return Math.floor(time / 1000);
}

function normalizeProject(raw, requestedName) {
  const p = raw?.project && typeof raw.project === 'object' ? raw.project : raw;
  const reportedName = p?.project_id ?? p?.name;
  if (typeof reportedName !== 'string' || reportedName !== requestedName) return null;
  return {
    id: boundedText(p?._id ?? p?.id, 100),
    name: boundedText(reportedName, 100),
    type: boundedText(p?.type, 40),
    status: boundedText(p?.status, 40),
    isDeployed: typeof p?.isDeployed === 'boolean' ? p.isDeployed : null,
  };
}

function normalizeReleases(raw) {
  if (!Array.isArray(raw?.releases)) return null;
  const currentId = typeof raw.currentRelease === 'string' ? raw.currentRelease : null;
  const releases = raw.releases.map(release => ({
    id: boundedText(release?._id, 100),
    tag: boundedText(release?.tag, 80),
    state: boundedText(release?.state, 40),
    createdAt: boundedText(release?.createdAt, 40),
    finishedAt: boundedText(release?.finishedAt, 40),
    current: Boolean(currentId && release?._id === currentId),
  }));
  const ids = releases.map(release => release.id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || (currentId && !ids.includes(currentId))) return null;
  return {
    currentReleaseId: currentId,
    releases,
  };
}

const MAX_RESPONSE_BYTES = 1_048_576;

function normalizeV2Logs(raw, expectedReleaseId, { since, until } = {}) {
  if (!Array.isArray(raw?.data)) return { correlation: 'UNCONFIRMED', logs: [], signals: [], startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null } };
  const logs = [];
  let attributionCertain = true;
  let validEntryCount = 0;
  if (raw.data.length === 0) attributionCertain = false;
  for (const group of raw.data) {
    const attributedId = group?.metaData?.releaseId;
    if (typeof attributedId !== 'string' || attributedId !== expectedReleaseId) attributionCertain = false;
    if (!Array.isArray(group?.values) || group.values.length === 0) { attributionCertain = false; continue; }
    for (const tuple of group.values) {
      if (!Array.isArray(tuple) || tuple.length < 2 || !(typeof tuple[0] === 'string' || typeof tuple[0] === 'number') || typeof tuple[1] !== 'string') { attributionCertain = false; continue; }
      const text = entryText(tuple[1]);
      const signals = signalsFrom(text);
      const missingEntrypoint = missingEntrypointFrom(text);
      const rawTimestamp = String(tuple[0]);
      const timestamp = boundedText(rawTimestamp, 40);
      let numericTimestamp;
      try { numericTimestamp = timeSeconds(rawTimestamp, 'Log timestamp'); }
      catch { attributionCertain = false; continue; }
      if (numericTimestamp < since || numericTimestamp > until) continue;
      validEntryCount++;
      logs.push({
        timestamp,
        releaseId: attributionCertain ? expectedReleaseId : null,
        signals,
        missingEntrypoint,
      });
    }
  }
  const confirmed = attributionCertain && validEntryCount > 0;
  if (!confirmed) for (const log of logs) log.releaseId = null;
  const startupFailure = logs.some(log => log.missingEntrypoint)
    ? { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' }
    : { status: 'UNCONFIRMED', code: null, entrypoint: null };
  return { correlation: confirmed ? 'CONFIRMED' : 'UNCONFIRMED', logs, signals: [...new Set(logs.flatMap(log => log.signals))], startupFailure };
}

/** GET-only adapter based on Liara PaaS OpenAPI and CLI read commands. */
export class LiaraReadOnlyAdapter {
  constructor({ token, teamId, fetchImpl = fetch, timeoutMs = 8000, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
    if (typeof token !== 'string' || !token.trim()) throw new TypeError('A scoped token must be supplied outside source control');
    if (teamId !== undefined && (typeof teamId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(teamId))) throw new TypeError('Invalid Liara team ID');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new TypeError('timeoutMs must be an integer from 1 to 60000');
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 16 * MAX_RESPONSE_BYTES) throw new TypeError('maxResponseBytes must be from 1 to 16 MiB');
    this.token = token;
    this.teamId = teamId;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async getProject(name) {
    const result = await this.#request('project', name);
    if (result.status !== 'AVAILABLE') return { status: result.status, httpStatus: result.httpStatus, ...(result.error ? { error: result.error } : {}), data: null };
    const data = normalizeProject(result.raw, name);
    return data ? { status: 'AVAILABLE', httpStatus: result.httpStatus, data } : { status: 'UNKNOWN', httpStatus: result.httpStatus, data: null };
  }

  /** Documented PaaS v1 logs operation. It has no release selector, so correlation remains unconfirmed. */
  async getLogs(name, since) {
    if (typeof since !== 'string' || !since.trim()) throw new TypeError('The documented since query parameter is required');
    const result = await this.#request('logs', name, { since });
    if (result.status !== 'AVAILABLE') return { status: result.status, httpStatus: result.httpStatus, correlation: 'UNCONFIRMED', releaseLogAttribution: 'UNCONFIRMED', startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null }, sourceToReleaseCorrespondence: 'UNCONFIRMED', signals: [] };
    const lines = Array.isArray(result.raw) ? result.raw : Array.isArray(result.raw?.logs) ? result.raw.logs : [];
    const texts = lines.map(line => typeof line?.message === 'string' ? line.message : '');
    const signals = [...new Set(texts.flatMap(signalsFrom))];
    const entrypointFound = texts.some(text => missingEntrypointFrom(text) !== null);
    return { status: 'AVAILABLE', httpStatus: result.httpStatus, correlation: 'UNCONFIRMED', releaseLogAttribution: 'UNCONFIRMED', startupFailure: entrypointFound ? { status: 'CONFIRMED', code: 'MODULE_NOT_FOUND', entrypoint: 'missing.mjs' } : { status: 'UNCONFIRMED', code: null, entrypoint: null }, sourceToReleaseCorrespondence: 'UNCONFIRMED', count: lines.length, signals };
  }

  /** Public v1 release listing with CLI-compatible page/count, normalized to a safe allowlist. */
  async getReleases(name, { page = 1, count = 100 } = {}) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(count) || count < 1 || count > 100) throw new TypeError('Invalid release page or count');
    const result = await this.#request('releases', name, { page, count });
    if (result.status !== 'AVAILABLE') return { status: result.status, httpStatus: result.httpStatus, ...(result.error ? { error: result.error } : {}), data: null };
    const normalized = normalizeReleases(result.raw);
    return normalized ? { status: 'AVAILABLE', httpStatus: result.httpStatus, data: normalized } : { status: 'UNKNOWN', httpStatus: result.httpStatus, data: null };
  }

  /** CLI-compatible v2 release-filtered log request after resolving a tag through the v1 release list. */
  async getReleaseLogs(name, { releaseTag, since, until, lastLines = true, releases: suppliedReleases } = {}) {
    if (typeof releaseTag !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(releaseTag)) throw new TypeError('A valid release tag is required');
    const start = timeSeconds(since, 'since');
    const end = until === undefined ? start + 6 * 60 * 60 : timeSeconds(until, 'until');
    if (end < start || end - start > 6 * 60 * 60) throw new TypeError('The selected log window must be ordered and no longer than six hours');
    const releaseResult = suppliedReleases
      ? { status: 'AVAILABLE', data: suppliedReleases }
      : await this.getReleases(name, { page: 1, count: 100 });
    if (releaseResult.status !== 'AVAILABLE') return { status: releaseResult.status, correlation: 'UNCONFIRMED', releaseLogAttribution: 'UNCONFIRMED', startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null }, sourceToReleaseCorrespondence: 'UNCONFIRMED', release: null, logs: [], signals: [] };
    const matches = releaseResult.data.releases.filter(item => item.tag?.toLowerCase() === releaseTag.toLowerCase());
    if (matches.length !== 1 || !matches[0]?.id) return { status: matches.length > 1 ? 'UNKNOWN' : 'UNAVAILABLE', correlation: 'UNCONFIRMED', releaseLogAttribution: 'UNCONFIRMED', startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null }, sourceToReleaseCorrespondence: 'UNCONFIRMED', release: null, logs: [], signals: [] };
    const release = matches[0];
    const result = await this.#request('releaseLogs', name, { start, direction: 'forward', last_lines: Boolean(lastLines), releaseId: release.id });
    if (result.status !== 'AVAILABLE') return { status: result.status, httpStatus: result.httpStatus, ...(result.error ? { error: result.error } : {}), correlation: 'UNCONFIRMED', releaseLogAttribution: 'UNCONFIRMED', startupFailure: { status: 'UNCONFIRMED', code: null, entrypoint: null }, sourceToReleaseCorrespondence: 'UNCONFIRMED', release: { id: release.id, tag: release.tag }, logs: [], signals: [] };
    const normalized = normalizeV2Logs(result.raw, release.id, { since: start, until: end });
    return { status: 'AVAILABLE', httpStatus: result.httpStatus, ...normalized, release: { id: release.id, tag: release.tag }, releaseLogAttribution: normalized.correlation, sourceToReleaseCorrespondence: 'UNCONFIRMED' };
  }

  async #request(operation, name, params = {}) {
    validateProjectName(name);
    const result = await requestLiaraReadOnly({ fetchImpl: this.fetchImpl, token: this.token, teamId: this.teamId,
      operation, projectName: name, params, timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes });
    if (result.status !== 'AVAILABLE') return { status: result.status, httpStatus: result.httpStatus,
      ...(result.errorCode ? { error: { code: result.errorCode } } : {}) };
    try {
      const raw = parseStrictJson(Buffer.from(result.bytes).toString('utf8'), { maxBytes: this.maxResponseBytes });
      return { status: 'AVAILABLE', httpStatus: result.httpStatus, raw };
    } catch {
      return { status: 'UNKNOWN', httpStatus: result.httpStatus };
    }
  }
}
