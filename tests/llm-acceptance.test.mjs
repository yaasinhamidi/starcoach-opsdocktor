import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/boxapi-one-shot.mjs', import.meta.url));
const sdkPackage = JSON.parse(readFileSync(new URL('../node_modules/@starcoach/core-llm/package.json', import.meta.url), 'utf8'));
const cleanEnv = () => {
  const env = { ...process.env };
  for (const key of ['BOXAPI_API_KEY', 'LIARA_LLM_ACCEPTANCE_APPROVED', 'LIARA_LLM_OWNER_AUTHORIZED', 'LIARA_DIAGNOSIS_PROVIDER', 'LIARA_DIAGNOSIS_ADAPTER']) delete env[key];
  return env;
};
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...cleanEnv(), ...env } });

test('acceptance preflight is offline, exact, and does not require a credential', () => {
  assert.equal(sdkPackage.name, '@starcoach/core-llm');
  assert.equal(sdkPackage.version, '0.5.0');
  const result = run(['--preflight-only']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, 'PREFLIGHT_PASSED');
  assert.equal(plan.mode, 'PREFLIGHT_ONLY');
  assert.equal(plan.adapter, 'shared');
  assert.equal(plan.sdk, '@starcoach/core-llm@0.5.0');
  assert.equal(plan.provider, 'boxapi');
  assert.equal(plan.endpoint, 'https://ai.boxapi.ir/ai/v1/chat/completions');
  assert.equal(plan.requestedModel, 'openai/gpt-4.1-mini');
  assert.equal(plan.credentialSource, 'BOXAPI_API_KEY');
  assert.equal(plan.credentialConfigured, false);
  assert.deepEqual(plan.requestQuota, { maxAttempts: 1, windowSeconds: 60, maxConcurrent: 1 });
  assert.equal(plan.expectedMaximumRequestAttempts, 1);
  assert.equal(plan.retryPolicy, 'NONE');
  assert.equal(plan.paidFallback, 'DISABLED');
  assert.equal(plan.maximumCostAtConfiguredBoundsUsd, 0.001242);
  assert.equal(plan.costCapUsd, 0.02);
  assert.equal(result.signal, null);
});

test('acceptance execution requires every explicit gate before any transport is possible', () => {
  const noApproval = run(['--execute']);
  assert.equal(noApproval.status, 2);
  assert.equal(JSON.parse(noApproval.stderr).reason, 'OWNER_ACCEPTANCE_APPROVAL_MISSING');
  assert.equal(JSON.parse(noApproval.stderr).requestAttempts, 0);

  const noOptIn = run(['--execute'], { LIARA_LLM_ACCEPTANCE_APPROVED: 'YES' });
  assert.equal(noOptIn.status, 2);
  assert.equal(JSON.parse(noOptIn.stderr).reason, 'OWNER_OPT_IN_MISSING');
  assert.equal(JSON.parse(noOptIn.stderr).requestAttempts, 0);

  const wrongProvider = run(['--execute'], { LIARA_LLM_ACCEPTANCE_APPROVED: 'YES', LIARA_LLM_OWNER_AUTHORIZED: 'YES', LIARA_DIAGNOSIS_PROVIDER: 'openrouter' });
  assert.equal(wrongProvider.status, 2);
  assert.equal(JSON.parse(wrongProvider.stderr).reason, 'PROVIDER_SELECTION_MISMATCH');
  assert.equal(JSON.parse(wrongProvider.stderr).requestAttempts, 0);

  const noKey = run(['--execute'], { LIARA_LLM_ACCEPTANCE_APPROVED: 'YES', LIARA_LLM_OWNER_AUTHORIZED: 'YES', LIARA_DIAGNOSIS_PROVIDER: 'boxapi' });
  assert.equal(noKey.status, 2);
  assert.equal(JSON.parse(noKey.stderr).reason, 'BOXAPI_API_KEY_MISSING');
  assert.equal(JSON.parse(noKey.stderr).requestAttempts, 0);
});

test('acceptance without an explicit mode is blocked', () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).reason, 'EXPLICIT_MODE_REQUIRED');
  assert.equal(JSON.parse(result.stderr).requestAttempts, 0);
});
