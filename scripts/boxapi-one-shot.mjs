import { DIAGNOSIS_SYSTEM_PROMPT, SharedDiagnosisProvider, evaluateAcceptance, makeDiagnosisEvidence } from '../src/diagnosis-providers.mjs';

const SDK_ID = '@starcoach/core-llm@0.5.0';
const MODEL = 'openai/gpt-4.1-mini';
const BASE_URL = 'https://ai.boxapi.ir/ai/v1/';
const ENDPOINT = `${BASE_URL}chat/completions`;
const INPUT_RATE_USD_PER_MILLION = 0.46;
const OUTPUT_RATE_USD_PER_MILLION = 1.84;
const INPUT_TOKEN_LIMIT = 1500;
const OUTPUT_TOKEN_LIMIT = 300;
const TIMEOUT_MS = 20_000;
const MAX_COST_USD = 0.02;
const REQUEST_QUOTA = Object.freeze({ maxAttempts: 1, windowSeconds: 60, maxConcurrent: 1 });
const EXPECTED_DIAGNOSIS = 'failed_release_missing_startup_entrypoint';

const execute = process.argv.includes('--execute');
const preflightOnly = process.argv.includes('--preflight-only');

function emit(value) { console.log(JSON.stringify(value)); }
function blocked(reason, details = {}) {
  console.error(JSON.stringify({ status: 'BLOCKED', reason, requestAttempts: 0, ...details }));
  process.exit(2);
}

if (execute === preflightOnly) blocked('EXPLICIT_MODE_REQUIRED', { usage: 'node scripts/boxapi-one-shot.mjs --preflight-only | --execute' });

const apiKey = process.env.BOXAPI_API_KEY;
const credentialConfigured = typeof apiKey === 'string' && apiKey.trim() !== '';
function sanitize(value) {
  let text = typeof value === 'string' && value.trim() ? value : 'Request failed';
  if (credentialConfigured) text = text.split(apiKey).join('[REDACTED]');
  return text.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '').slice(0, 200);
}

const evidence = makeDiagnosisEvidence({
  source: 'REPLAY',
  expectedReleaseId: 'synthetic-release-001',
  releaseState: 'FAILED',
  logs: [{
    releaseId: 'synthetic-release-001',
    timestamp: '2026-10-22T00:00:00Z',
    signals: ['MODULE_NOT_FOUND'],
    missingEntrypoint: 'missing.mjs',
  }],
});
const evidenceForPrompt = evidence.items.map(({ id, releaseId, source, timestamp, signals, missingEntrypoint, releaseState }) => ({ id, releaseId, source, timestamp, signals, missingEntrypoint, releaseState }));
const userText = JSON.stringify({ selectedReleaseId: evidence.expectedReleaseId, source: evidence.source, evidence: evidenceForPrompt });
const estimatedInputTokenUpperBound = Buffer.byteLength(DIAGNOSIS_SYSTEM_PROMPT, 'utf8') + Buffer.byteLength(userText, 'utf8') + 20;
if (estimatedInputTokenUpperBound > INPUT_TOKEN_LIMIT) blocked('INPUT_LIMIT_EXCEEDED', { estimatedInputTokenUpperBound, inputTokenLimit: INPUT_TOKEN_LIMIT });

const estimatedMaximumCostUsd = (INPUT_TOKEN_LIMIT * INPUT_RATE_USD_PER_MILLION + OUTPUT_TOKEN_LIMIT * OUTPUT_RATE_USD_PER_MILLION) / 1_000_000;
if (!Number.isFinite(estimatedMaximumCostUsd) || estimatedMaximumCostUsd >= MAX_COST_USD) blocked('COST_LIMIT_NOT_MET', { estimatedMaximumCostUsd, maximumAllowedUsd: MAX_COST_USD });

emit({
  status: 'PREFLIGHT_PASSED',
  mode: execute ? 'EXECUTE' : 'PREFLIGHT_ONLY',
  adapter: 'shared',
  sdk: SDK_ID,
  provider: 'boxapi',
  endpoint: ENDPOINT,
  requestedModel: MODEL,
  evidenceMode: 'REPLAY',
  evidenceIds: evidence.items.map(item => item.id),
  credentialSource: 'BOXAPI_API_KEY',
  credentialConfigured,
  ownerOptInConfigured: process.env.LIARA_LLM_OWNER_AUTHORIZED === 'YES',
  acceptanceApprovalConfigured: process.env.LIARA_LLM_ACCEPTANCE_APPROVED === 'YES',
  requestQuota: REQUEST_QUOTA,
  timeoutMs: TIMEOUT_MS,
  inputTokenUpperBound: INPUT_TOKEN_LIMIT,
  outputTokenLimit: OUTPUT_TOKEN_LIMIT,
  maximumCostAtConfiguredBoundsUsd: estimatedMaximumCostUsd,
  costCapUsd: MAX_COST_USD,
  transportMode: 'LIVE_LLM',
  expectedMaximumRequestAttempts: 1,
  retryPolicy: 'NONE',
  paidFallback: 'DISABLED',
  costCapIsBillingGuarantee: false,
  note: 'Pricing estimate, not a guaranteed billing cap. One inference attempt only.',
});

if (preflightOnly) process.exit(0);
if (process.env.LIARA_LLM_ACCEPTANCE_APPROVED !== 'YES') blocked('OWNER_ACCEPTANCE_APPROVAL_MISSING');
if (process.env.LIARA_LLM_OWNER_AUTHORIZED !== 'YES') blocked('OWNER_OPT_IN_MISSING');
if (process.env.LIARA_DIAGNOSIS_PROVIDER !== 'boxapi') blocked('PROVIDER_SELECTION_MISMATCH');
if (process.env.LIARA_DIAGNOSIS_ADAPTER && process.env.LIARA_DIAGNOSIS_ADAPTER !== 'shared') blocked('ADAPTER_SELECTION_MISMATCH');
if (!credentialConfigured) blocked('BOXAPI_API_KEY_MISSING');

let requestAttempts = 0;
const fetchOnce = async (url, options) => {
  requestAttempts += 1;
  if (requestAttempts > 1) throw new Error('ONE_SHOT_GUARD');
  if (String(url) !== ENDPOINT) throw new Error('ENDPOINT_MISMATCH');
  if (options?.method !== 'POST') throw new Error('METHOD_MISMATCH');
  return fetch(url, options);
};

try {
  const provider = new SharedDiagnosisProvider({
    provider: 'boxapi',
    apiKey,
    model: MODEL,
    baseUrl: BASE_URL,
    fetchImpl: fetchOnce,
    transportMode: 'LIVE_LLM',
    timeoutMs: TIMEOUT_MS,
    maxCompletionTokens: OUTPUT_TOKEN_LIMIT,
    maxCostUsd: MAX_COST_USD,
    inputUsdPerMillion: INPUT_RATE_USD_PER_MILLION,
    outputUsdPerMillion: OUTPUT_RATE_USD_PER_MILLION,
    requestQuota: REQUEST_QUOTA,
  });
  const result = await provider.diagnose(evidence);
  const verdict = evaluateAcceptance({ result, evidence, requestAttempts, sdkId: SDK_ID, expectedDiagnosis: EXPECTED_DIAGNOSIS });
  const { evidenceValid, sharedProvenanceValid } = verdict;
  emit({
    status: 'LIVE_LLM_RESULT',
    adapter: result.adapter,
    sdk: result.provenance?.sdk ?? null,
    provider: result.provider,
    endpoint: ENDPOINT,
    requestAttempts,
    httpStatus: result.provenance?.httpStatus ?? null,
    latencyMs: result.provenance?.latencyMs ?? null,
    requestedModel: result.provenance?.requestedModel ?? null,
    returnedModel: result.provenance?.returnedModel ?? null,
    mode: result.mode,
    origin: result.origin,
    evidenceMode: 'REPLAY',
    diagnosis: result.diagnosis,
    summary: result.summary,
    confidence: result.confidence,
    evidenceIds: result.evidenceIds,
    evidenceValidation: evidenceValid ? 'PASS' : 'FAIL',
    schemaValidation: 'PASS',
    sharedProvenanceValidation: sharedProvenanceValid ? 'PASS' : 'FAIL',
    diagnosisMatchesExpected: verdict.diagnosisMatchesExpected,
    acceptance: verdict.passed ? 'PASS' : 'FAIL',
    repairHint: result.repairHint,
    actionExecuted: false,
    usage: result.usage,
    maximumCostAtConfiguredBoundsUsd: estimatedMaximumCostUsd,
    costCapUsd: MAX_COST_USD,
    costCapIsBillingGuarantee: false,
  });
  if (!verdict.passed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    status: requestAttempts === 0 ? 'BLOCKED' : 'LIVE_LLM_FAILED',
    adapter: 'shared',
    sdk: SDK_ID,
    provider: 'boxapi',
    endpoint: ENDPOINT,
    requestAttempts,
    requestedModel: MODEL,
    errorCode: typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
    error: sanitize(error?.message),
    httpStatus: Number.isInteger(error?.details?.httpStatus) ? error.details.httpStatus : null,
    providerErrorCode: typeof error?.details?.providerErrorCode === 'string' ? error.details.providerErrorCode : null,
    sanitizedProviderMessage: typeof error?.details?.sanitizedMessage === 'string' ? error.details.sanitizedMessage : null,
    latencyMs: Number.isFinite(error?.details?.latencyMs) ? error.details.latencyMs : null,
    deterministicFallbackExpected: true,
    actionExecuted: false,
    maximumCostAtConfiguredBoundsUsd: estimatedMaximumCostUsd,
    costCapIsBillingGuarantee: false,
  }));
  process.exitCode = requestAttempts === 0 ? 2 : 1;
}
