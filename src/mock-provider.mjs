import { createHash } from 'node:crypto';

function unsupported() {
  throw new TypeError('Plan contains unsupported data');
}

// Read only own data descriptors and copy them into a fresh JSON-shaped tree.
// A Proxy cannot be reliably identified in JavaScript; callers must provide
// inert values (normally JSON.parse output). Even if a Proxy is passed, only
// this one captured tree is hashed and used by deploy, never the original.
function captureJson(value, ignoreLegacyHash = false) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return unsupported();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return unsupported();
    const copy = [];
    for (let index = 0; index < value.length; index++) {
      const key = String(index);
      if (!Object.hasOwn(value, key)) return unsupported();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return unsupported();
      copy.push(captureJson(descriptor.value));
    }
    return Object.freeze(copy);
  }

  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return unsupported();
    const copy = {};
    for (const key of keys.sort()) {
      if (ignoreLegacyHash && key === 'hash') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return unsupported();
      Object.defineProperty(copy, key, {
        value: captureJson(descriptor.value), enumerable: true, writable: false, configurable: false,
      });
    }
    return Object.freeze(copy);
  }
  return unsupported();
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function digestSnapshot(snapshot) {
  return createHash('sha256').update(canonicalize(snapshot)).digest('hex');
}

/** SHA-256 of a captured, JSON-compatible deployment plan. Top-level legacy hash is ignored. */
export function planDigest(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.getPrototypeOf(plan) !== Object.prototype) {
    throw new TypeError('A plain deployment plan is required');
  }
  return digestSnapshot(captureJson(plan, true));
}

export class MockDeploymentProvider {
  constructor({ candidateState = 'READY', activateCandidate = true, candidateVersion } = {}) {
    if (!['READY', 'FAILED'].includes(candidateState)) throw new TypeError('Unsupported mock candidate state');
    this.candidateState = candidateState;
    this.activateCandidate = activateCandidate;
    this.candidateVersion = candidateVersion;
    this.releases = new Map([['stable-1', { id: 'stable-1', state: 'READY', version: 'stable', current: true }]]);
    this.currentRelease = 'stable-1';
    this.nextCandidate = 1;
  }

  deploy(plan, approval) {
    if (typeof approval !== 'string' || !/^[a-f0-9]{64}$/.test(approval)) throw new Error('Exact plan approval required');
    let snapshot;
    let actualDigest;
    try {
      if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.getPrototypeOf(plan) !== Object.prototype) {
        throw new TypeError('A plain deployment plan is required');
      }
      snapshot = captureJson(plan, true);
      actualDigest = digestSnapshot(snapshot);
    } catch {
      throw new Error('Exact plan approval required');
    }
    if (approval !== actualDigest) throw new Error('Exact plan approval required');
    if (snapshot.action !== 'deploy' || typeof snapshot.version !== 'string' || !snapshot.version.trim()) {
      throw new TypeError('A deployment action and version are required');
    }

    // All execution inputs come from the exact immutable value tree whose digest was checked.
    const id = `candidate-${this.nextCandidate++}`;
    const version = this.candidateVersion ?? snapshot.version;
    const current = this.candidateState === 'READY' && this.activateCandidate;
    const release = { id, state: this.candidateState, version, current };
    this.releases.set(id, release);
    if (current) this.currentRelease = id;
    return { ...release };
  }

  verifyCandidate(candidate, expectedVersion) {
    const id = typeof candidate === 'string' ? candidate : candidate?.id;
    const release = typeof id === 'string' ? this.releases.get(id) : undefined;
    const state = release?.state ?? 'UNKNOWN';
    const version = release?.version ?? null;
    const current = Boolean(release && this.currentRelease === release.id && release.current);
    const claimedIdentityMatches = typeof candidate === 'string' || (candidate?.id === release?.id && candidate?.version === version);
    const expectedVersionMatches = typeof expectedVersion === 'string' && version === expectedVersion;
    return {
      ok: Boolean(release && claimedIdentityMatches && state === 'READY' && current && expectedVersionMatches),
      candidateId: id ?? null,
      state,
      current,
      version,
    };
  }
}
