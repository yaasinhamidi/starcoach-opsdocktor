import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIAGNOSIS_SYSTEM_PROMPT,
  DiagnosisProviderError,
  OpenAICompatibleDiagnosisProvider,
  SharedDiagnosisProvider,
  diagnoseWithFallback,
  evaluateAcceptance,
  makeDiagnosisEvidence,
} from '../src/diagnosis-providers.mjs';

const evidence = () => makeDiagnosisEvidence({ source: 'REPLAY', expectedReleaseId: 'release-1', releaseState: 'FAILED', logs: [{ releaseId: 'release-1', timestamp: '1792573200', signals: ['MODULE_NOT_FOUND'], missingEntrypoint: 'missing.mjs' }] });
const base = overrides => ({
  provider: 'boxapi', apiKey: 'test-key-not-real', model: 'test/model', baseUrl: 'https://ai.boxapi.ir/ai/v1/', transportMode: 'MOCK',
  timeoutMs: 100, maxCompletionTokens: 25, maxCostUsd: 0.01, inputUsdPerMillion: 1, outputUsdPerMillion: 1, ...overrides,
});
const forbiddenFetch = () => { const calls = []; const fn = async (...args) => { calls.push(args); throw new Error('network must not be reached'); }; fn.calls = calls; return fn; };

test('cost gate counts the system prompt as billed input', async () => {
  const systemOnlyCost = (Math.ceil(DIAGNOSIS_SYSTEM_PROMPT.length / 4) + 25) / 1_000_000;
  const tooTight = systemOnlyCost - 1e-9; // user text alone would pass this cap; the system prompt alone already exceeds it
  const legacyFetch = forbiddenFetch();
  const legacy = new OpenAICompatibleDiagnosisProvider(base({ maxCostUsd: tooTight, fetchImpl: legacyFetch }));
  await assert.rejects(() => legacy.diagnose(evidence()), error => error instanceof DiagnosisProviderError && error.code === 'BUDGET_EXCEEDED');
  const sharedFetch = forbiddenFetch();
  const shared = new SharedDiagnosisProvider(base({ maxCostUsd: tooTight, fetchImpl: sharedFetch, requestQuota: { maxAttempts: 1, windowSeconds: 60, maxConcurrent: 1 } }));
  await assert.rejects(() => shared.diagnose(evidence()), error => error instanceof DiagnosisProviderError && error.code === 'BUDGET_EXCEEDED');
  assert.equal(legacyFetch.calls.length + sharedFetch.calls.length, 0);
});

test('an injected fetch is never labelled LIVE_LLM unless the caller says so explicitly', () => {
  const { transportMode: _omit, ...withoutMode } = base({});
  assert.equal(new OpenAICompatibleDiagnosisProvider({ ...withoutMode, fetchImpl: forbiddenFetch() }).status().transportMode, 'MOCK');
  assert.equal(new SharedDiagnosisProvider({ ...withoutMode, fetchImpl: forbiddenFetch(), requestQuota: { maxAttempts: 1, windowSeconds: 60, maxConcurrent: 1 } }).status().transportMode, 'MOCK');
  assert.equal(new OpenAICompatibleDiagnosisProvider(withoutMode).status().transportMode, 'LIVE_LLM'); // global fetch: constructed only, nothing is sent
});

test('acceptance verdict fails a wrong diagnosis, a mock transport and a missing real attempt', () => {
  const input = evidence();
  const sdkId = '@starcoach/core-llm@0.5.0';
  const expectedDiagnosis = 'failed_release_missing_startup_entrypoint';
  const good = { diagnosis: expectedDiagnosis, evidenceIds: [input.items[0].id], origin: 'PROVIDER', adapter: 'shared', mode: 'LIVE_LLM', provenance: { sdk: sdkId, httpStatus: 200 } };
  const judge = (result, requestAttempts = 1) => evaluateAcceptance({ result, evidence: input, requestAttempts, sdkId, expectedDiagnosis });
  assert.equal(judge(good).passed, true);
  const wrong = judge({ ...good, diagnosis: 'other' });
  assert.equal(wrong.passed, false);
  assert.equal(wrong.diagnosisMatchesExpected, false);
  assert.equal(judge({ ...good, mode: 'MOCK' }).passed, false);
  assert.equal(judge(good, 0).passed, false);
  assert.equal(judge({ ...good, provenance: { sdk: sdkId, httpStatus: null } }).passed, false);
  assert.equal(judge({ ...good, evidenceIds: ['ev_unknown'] }).passed, false);
});

test('the acceptance script exits non-zero whenever the verdict does not pass', () => {
  const source = readFileSync(new URL('../scripts/boxapi-one-shot.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(!verdict\.passed\) process\.exitCode = 1;/);
  assert.doesNotMatch(source, /if \(!evidenceValid \|\| !sharedProvenanceValid\) process\.exitCode/);
});

test('a provider rejection yields the deterministic diagnosis after exactly one attempt and never switches provider', async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts += 1; return { ok: false, status: 403, headers: { get: () => null }, async text() { return ''; }, async json() { return {}; } }; };
  const provider = new OpenAICompatibleDiagnosisProvider(base({ fetchImpl }));
  const result = await diagnoseWithFallback(provider, evidence());
  assert.equal(attempts, 1);
  assert.equal(result.diagnosis.origin, 'DETERMINISTIC');
  assert.equal(result.fallback.reason, 'HTTP_ERROR');
  assert.equal(result.providerStatus.provider, 'boxapi');
});
