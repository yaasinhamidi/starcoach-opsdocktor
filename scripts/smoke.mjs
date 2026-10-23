import assert from 'node:assert/strict';
import { MockDeploymentProvider, planDigest } from '../src/mock-provider.mjs';
const provider = new MockDeploymentProvider();
const plan = { action: 'deploy', version: 'fixture-v2' };
assert.throws(() => provider.deploy(plan, ''), /approval/i);
const result = provider.deploy(plan, planDigest(plan));
assert.equal(result.state, 'READY'); assert.equal(result.current, true); assert.equal(provider.currentRelease, result.id);
assert.equal(provider.verifyCandidate(result, plan.version).ok, true);
console.log('Liara offline MOCK smoke: approval digest and mock candidate verification passed (no live Liara integration)');
