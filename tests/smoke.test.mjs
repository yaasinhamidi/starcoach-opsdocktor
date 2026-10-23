import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { MockDeploymentProvider, planDigest } from '../src/mock-provider.mjs';
import { inspectRepository } from '../src/inspector.mjs';
const fixture = fileURLToPath(new URL('../fixtures/broken-node-app/', import.meta.url));
test('static inspection finds missing start and port mismatch without executing scripts', async () => {
  const findings = await inspectRepository(fixture);
  assert.deepEqual(findings.map(x => x.code), ['NODE_START_MISSING', 'PORT_CONFIG_MISMATCH']);
});
test('mock deploy requires an approval digest for the exact plan', () => {
  const provider = new MockDeploymentProvider();
  const plan = { action: 'deploy', version: 'v2' };
  assert.throws(() => provider.deploy(plan, ''), /approval/i);
  const result = provider.deploy(plan, planDigest(plan));
  assert.equal(result.current, true);
  assert.equal(provider.verifyCandidate(result, 'v2').ok, true);
});
