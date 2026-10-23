import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DiagnosisProviderError,
  OpenAICompatibleDiagnosisProvider,
  SharedDiagnosisProvider,
  createDiagnosisProviderFromEnv,
  diagnoseWithFallback,
  makeDiagnosisEvidence,
} from '../src/diagnosis-providers.mjs';

const evidence = () => makeDiagnosisEvidence({ source: 'REPLAY', expectedReleaseId: 'release-1', releaseState: 'FAILED', logs: [{ releaseId: 'release-1', timestamp: '1792573200', signals: ['MODULE_NOT_FOUND'], missingEntrypoint: 'missing.mjs' }] });
const config = overrides => ({
  provider: 'openrouter', apiKey: 'secret-never-log', model: 'test/model', upstreamProvider: 'test-provider', baseUrl: 'https://openrouter.ai/api/v1/',
  transportMode: 'MOCK',
  timeoutMs: 100, maxCompletionTokens: 25, maxCostUsd: 0.01, inputUsdPerMillion: 1, outputUsdPerMillion: 1,
  ...overrides,
});
const completion = (item, overrides = {}) => ({
  ok: true, status: 200,
  headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
  async json() {
    return {
      model: 'router/model',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        diagnosis: 'failed_release_missing_startup_entrypoint', summary: 'Confirmed startup entrypoint evidence.', confidence: 'high',
        evidenceIds: [item.items[0].id], repairHint: 'inspect-start-command',
      }) } }],
      usage: { prompt_tokens: 50, completion_tokens: 15 },
      ...overrides,
    };
  },
});

test('provider factory switches independently and uses provider-specific keys, models, and bases', async () => {
  const base = { LIARA_LLM_OWNER_AUTHORIZED: 'YES', LIARA_LLM_MAX_REQUEST_COST_USD: '0.01', LIARA_LLM_MAX_COMPLETION_TOKENS: '25',
    LIARA_LLM_MAX_ATTEMPTS: '3', LIARA_LLM_WINDOW_SECONDS: '60', LIARA_LLM_MAX_CONCURRENT: '1' };
  const box = createDiagnosisProviderFromEnv({ ...base, LIARA_DIAGNOSIS_PROVIDER: 'boxapi', BOXAPI_API_KEY: 'box-secret', LIARA_BOXAPI_MODEL: 'box/model', LIARA_BOXAPI_INPUT_USD_PER_MILLION: '1', LIARA_BOXAPI_OUTPUT_USD_PER_MILLION: '2' });
  const router = createDiagnosisProviderFromEnv({ ...base, LIARA_DIAGNOSIS_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'router-secret', LIARA_OPENROUTER_MODEL: 'router/model', LIARA_OPENROUTER_UPSTREAM_PROVIDER: 'openai', LIARA_OPENROUTER_INPUT_USD_PER_MILLION: '3', LIARA_OPENROUTER_OUTPUT_USD_PER_MILLION: '4' });
  const boxStatus = box.status();
  const routerStatus = router.status();
  assert.ok(box instanceof SharedDiagnosisProvider);
  assert.ok(router instanceof SharedDiagnosisProvider);
  assert.equal(boxStatus.provider, 'boxapi');
  assert.equal(boxStatus.model, 'box/model');
  assert.equal(boxStatus.adapter, 'shared');
  assert.equal(boxStatus.sdk, '@starcoach/core-llm@0.5.0');
  assert.equal(boxStatus.connection, 'CONFIGURED_UNVERIFIED');
  assert.equal(boxStatus.budget, 'CONFIGURED');
  assert.deepEqual(boxStatus.requestQuota, { maxAttempts: 3, windowSeconds: 60, maxConcurrent: 1 });
  assert.equal(routerStatus.provider, 'openrouter');
  assert.equal(routerStatus.adapter, 'shared');
  assert.equal(routerStatus.connection, 'CONFIGURED_UNVERIFIED');
  assert.equal(createDiagnosisProviderFromEnv({}).status().provider, 'offline');
  const openai = createDiagnosisProviderFromEnv({ LIARA_DIAGNOSIS_PROVIDER: 'openai_chatgpt_plan' });
  assert.equal(openai.status().connection, 'UNAVAILABLE_ADAPTER');
  const unavailable = await diagnoseWithFallback(openai, evidence());
  assert.equal(unavailable.fallback.reason, 'UNAVAILABLE_ADAPTER');
  assert.equal(unavailable.diagnosis.provider, 'offline');
  assert.equal(unavailable.diagnosis.origin, 'DETERMINISTIC');
});

test('explicit request quota selects Shared generation while preserving evidence validation, cost limits and usage', async () => {
  const input = evidence();
  let sent;
  const provider = createDiagnosisProviderFromEnv({
    LIARA_DIAGNOSIS_PROVIDER: 'openrouter', LIARA_LLM_OWNER_AUTHORIZED: 'YES', OPENROUTER_API_KEY: 'test-key-only',
    LIARA_OPENROUTER_MODEL: 'router/model', LIARA_OPENROUTER_UPSTREAM_PROVIDER: 'openai',
    LIARA_LLM_TIMEOUT_MS: '100', LIARA_LLM_MAX_COMPLETION_TOKENS: '25', LIARA_LLM_MAX_REQUEST_COST_USD: '0.01',
    LIARA_OPENROUTER_INPUT_USD_PER_MILLION: '3', LIARA_OPENROUTER_OUTPUT_USD_PER_MILLION: '4',
    LIARA_LLM_MAX_ATTEMPTS: '3', LIARA_LLM_WINDOW_SECONDS: '60', LIARA_LLM_MAX_CONCURRENT: '1',
  }, { fetchImpl: async (url, options) => { sent = { url: String(url), body: JSON.parse(options.body), headers: { ...options.headers } }; return completion(input, { cost: 0.00002 }); } });
  assert.ok(provider instanceof SharedDiagnosisProvider);
  const result = await provider.diagnose(input);
  assert.equal(result.diagnosis, 'failed_release_missing_startup_entrypoint');
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.origin, 'PROVIDER');
  assert.equal(result.adapter, 'shared');
  assert.equal(result.provenance.sdk, '@starcoach/core-llm@0.5.0');
  assert.equal(result.provenance.requestedModel, 'router/model');
  assert.equal(result.provenance.returnedModel, 'router/model');
  assert.equal(result.provenance.httpStatus, 200);
  assert.ok(Number.isInteger(result.provenance.latencyMs));
  assert.equal(result.usage.inputTokens, 50);
  assert.equal(result.usage.providerCostUsd, 0.00002);
  assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(sent.body.provider, { only: ['openai'], allow_fallbacks: false });
  assert.deepEqual(sent.body.usage, { include: true });
  assert.equal(sent.body.messages[1].content.includes(input.items[0].id), true);
  assert.equal(JSON.stringify(sent.body).includes('test-key-only'), false, JSON.stringify(sent.body));
  await assert.rejects(() => provider.diagnose({ ...input, items: [{ ...input.items[0], releaseId: 'other-release' }] }), /selected release/i);
});

test('legacy provider remains explicitly selectable as a rollback path', () => {
  const provider = createDiagnosisProviderFromEnv({
    LIARA_DIAGNOSIS_PROVIDER: 'boxapi', LIARA_DIAGNOSIS_ADAPTER: 'legacy', LIARA_LLM_OWNER_AUTHORIZED: 'YES',
    BOXAPI_API_KEY: 'test-key', LIARA_BOXAPI_MODEL: 'box/model', LIARA_LLM_MAX_REQUEST_COST_USD: '1',
    LIARA_BOXAPI_INPUT_USD_PER_MILLION: '1', LIARA_BOXAPI_OUTPUT_USD_PER_MILLION: '1',
  }, { fetchImpl: async () => { throw new Error('test not invoked'); } });
  assert.ok(provider instanceof OpenAICompatibleDiagnosisProvider);
});

test('Shared and retained legacy diagnosis clients send equivalent offline request bodies', async () => {
  const baseEnv = { LIARA_DIAGNOSIS_PROVIDER: 'openrouter', LIARA_LLM_OWNER_AUTHORIZED: 'YES',
    OPENROUTER_API_KEY: 'test-key', LIARA_OPENROUTER_MODEL: 'router/model',
    LIARA_OPENROUTER_UPSTREAM_PROVIDER: 'openai', LIARA_LLM_TIMEOUT_MS: '100',
    LIARA_LLM_MAX_COMPLETION_TOKENS: '25', LIARA_LLM_MAX_REQUEST_COST_USD: '0.01',
    LIARA_OPENROUTER_INPUT_USD_PER_MILLION: '3', LIARA_OPENROUTER_OUTPUT_USD_PER_MILLION: '4',
    LIARA_LLM_MAX_ATTEMPTS: '3', LIARA_LLM_WINDOW_SECONDS: '60', LIARA_LLM_MAX_CONCURRENT: '1' };
  const input = evidence();
  const sent = [];
  const run = async adapter => {
    const provider = createDiagnosisProviderFromEnv({ ...baseEnv, ...(adapter ? { LIARA_DIAGNOSIS_ADAPTER: adapter } : {}) }, {
      fetchImpl: async (url, options) => {
        sent.push({ url: String(url), body: JSON.parse(options.body) });
        return completion(input);
      },
    });
    return provider.diagnose(input);
  };
  const shared = await run('shared');
  const legacy = await run('legacy');
  assert.equal(shared.diagnosis, legacy.diagnosis);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, sent[1].url);
  assert.deepEqual(sent[0].body, sent[1].body);
  assert.equal(sent[0].body.messages[1].content, sent[1].body.messages[1].content);
  assert.equal(JSON.stringify(sent[0].body).includes('test-key'), false);
});

test('missing credentials are explicit and never trigger a transport request', async () => {
  let calls = 0;
  const provider = createDiagnosisProviderFromEnv({ LIARA_DIAGNOSIS_PROVIDER: 'boxapi', LIARA_LLM_OWNER_AUTHORIZED: 'YES', LIARA_BOXAPI_MODEL: 'm', LIARA_LLM_MAX_REQUEST_COST_USD: '1', LIARA_BOXAPI_INPUT_USD_PER_MILLION: '1', LIARA_BOXAPI_OUTPUT_USD_PER_MILLION: '1', LIARA_LLM_MAX_ATTEMPTS: '1', LIARA_LLM_WINDOW_SECONDS: '60', LIARA_LLM_MAX_CONCURRENT: '1' }, { fetchImpl: async () => { calls++; } });
  const result = await diagnoseWithFallback(provider, evidence());
  assert.equal(calls, 0);
  assert.equal(result.fallback.reason, 'MISSING_CREDENTIALS');
  assert.equal(result.diagnosis.provider, 'offline');
  assert.equal(result.diagnosis.origin, 'DETERMINISTIC');
  assert.equal(result.providerStatus.connection, 'MISSING_CONFIGURATION');
  assert.equal(result.providerStatus.adapter, 'shared');
});

test('OpenRouter adapter sends the configured model and validated evidence only; reports usage and provider cost', async () => {
  const input = evidence();
  let request;
  const provider = new OpenAICompatibleDiagnosisProvider(config({ fetchImpl: async (url, options) => {
    request = { url: String(url), options, body: JSON.parse(options.body) };
    return completion(input, { cost: 0.00002 });
  } }));
  const result = await provider.diagnose(input);
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer secret-never-log');
  assert.equal(request.body.model, 'test/model');
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.max_tokens, 25);
  assert.deepEqual(request.body.usage, { include: true });
  assert.deepEqual(request.body.provider, { only: ['test-provider'], allow_fallbacks: false });
  assert.equal(JSON.stringify(request.body).includes('secret-never-log'), false);
  assert.equal(result.mode, 'MOCK');
  assert.equal(result.usage.providerCostUsd, 0.00002);
  assert.equal(result.usage.inputTokens, 50);
});

test('BoxAPI adapter uses its configured AI base and a provider-specific model', async () => {
  const input = evidence();
  let urlSeen;
  const provider = new OpenAICompatibleDiagnosisProvider(config({ provider: 'boxapi', baseUrl: 'https://ai.boxapi.ir/ai/v1/', model: 'box-model-x', fetchImpl: async url => {
    urlSeen = String(url);
    return completion(input);
  } }));
  const result = await provider.diagnose(input);
  assert.equal(urlSeen, 'https://ai.boxapi.ir/ai/v1/chat/completions');
  assert.equal(result.provider, 'boxapi');
  assert.equal(result.model, 'box-model-x');
});

test('BoxAPI request contract is fixed and a 403 reports allowlisted sanitized error data only', async () => {
  const input = evidence();
  const apiKey = 'test-boxapi-key-must-not-leak';
  let calls = 0;
  let request;
  const provider = new OpenAICompatibleDiagnosisProvider(config({
    provider: 'boxapi', apiKey, model: 'openai/gpt-4.1-mini', baseUrl: 'https://ai.boxapi.ir/ai/v1/',
    maxCompletionTokens: 300,
    fetchImpl: async (url, options) => {
      calls++;
      request = { url: String(url), options, body: JSON.parse(options.body) };
      return {
        ok: false,
        status: 403,
        async json() { return { error: { code: 'invalid_api_key', message: `private account alice@example.com rejected Bearer ${apiKey}` } }; },
      };
    },
  }));

  await assert.rejects(() => provider.diagnose(input), error => {
    assert.equal(error.code, 'HTTP_ERROR');
    assert.equal(error.details.httpStatus, 403);
    assert.equal(error.details.providerErrorCode, 'INVALID_API_KEY');
    assert.match(error.details.sanitizedMessage, /key type and status/i);
    const serialized = JSON.stringify({ message: error.message, details: error.details });
    assert.equal(serialized.includes(apiKey), false);
    assert.equal(serialized.includes('alice@example.com'), false);
    assert.equal(serialized.includes('private account'), false);
    return true;
  });

  assert.equal(calls, 1);
  assert.equal(request.url, 'https://ai.boxapi.ir/ai/v1/chat/completions');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.authorization, `Bearer ${apiKey}`);
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.equal(request.body.model, 'openai/gpt-4.1-mini');
  assert.equal(request.body.max_tokens, 300);
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.stream, false);
  assert.equal(JSON.stringify(request.body).includes(apiKey), false);
  assert.deepEqual(Object.keys(request.body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'temperature']);
});

test('BoxAPI unknown 403 body is withheld and no error body becomes a provider code', async () => {
  const provider = new OpenAICompatibleDiagnosisProvider(config({
    provider: 'boxapi', baseUrl: 'https://ai.boxapi.ir/ai/v1/',
    fetchImpl: async () => ({ ok: false, status: 403, async json() { return { error: { message: 'private account, cookie=session-secret, Authorization: Bearer hidden' } }; } }),
  }));
  await assert.rejects(() => provider.diagnose(evidence()), error => {
    assert.equal(error.details.httpStatus, 403);
    assert.equal(error.details.providerErrorCode, null);
    assert.match(error.details.sanitizedMessage, /response details were withheld/i);
    assert.equal(JSON.stringify(error.details).includes('session-secret'), false);
    assert.equal(JSON.stringify(error.details).includes('hidden'), false);
    assert.equal(JSON.stringify(error.details).includes('private account'), false);
    return true;
  });
});

test('explicit deterministic fallback exposes sanitized 403 metadata without forwarding the provider body', async () => {
  const apiKey = 'test-key-do-not-disclose';
  const provider = new OpenAICompatibleDiagnosisProvider(config({
    provider: 'boxapi', apiKey, baseUrl: 'https://ai.boxapi.ir/ai/v1/',
    fetchImpl: async () => ({ ok: false, status: 403, async json() { return { error: { code: 'permission_denied', message: `Bearer ${apiKey}; private-account-ref` } }; } }),
  }));
  const result = await diagnoseWithFallback(provider, evidence());
  assert.equal(result.fallback.reason, 'HTTP_ERROR');
  assert.equal(result.fallback.httpStatus, 403);
  assert.equal(result.fallback.providerErrorCode, 'PERMISSION_DENIED');
  assert.match(result.fallback.sanitizedProviderMessage, /denied model or endpoint permission/i);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal(JSON.stringify(result).includes('private-account-ref'), false);
  assert.equal(result.diagnosis.provider, 'offline');
});

test('Shared provider HTTP failure is sanitized, non-successful, and exposes SDK provenance', async () => {
  const apiKey = 'test-shared-boxapi-key-must-not-leak';
  const provider = new SharedDiagnosisProvider(config({
    provider: 'boxapi', apiKey, model: 'openai/gpt-4.1-mini', baseUrl: 'https://ai.boxapi.ir/ai/v1/',
    requestQuota: { maxAttempts: 1, windowSeconds: 60, maxConcurrent: 1 },
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
      async text() { return JSON.stringify({ error: { code: 'invalid_api_key', message: `private account ${apiKey}` } }); },
    }),
  }));
  const result = await diagnoseWithFallback(provider, evidence());
  assert.equal(result.fallback.reason, 'HTTP_ERROR');
  assert.equal(result.fallback.httpStatus, 403);
  assert.equal(result.fallback.providerErrorCode, 'INVALID_API_KEY');
  assert.match(result.fallback.sanitizedProviderMessage, /key type and status/i);
  assert.equal(result.diagnosis.origin, 'DETERMINISTIC');
  assert.equal(result.diagnosis.provenance, null);
  assert.equal(result.providerStatus.adapter, 'shared');
  assert.equal(result.providerStatus.sdk, '@starcoach/core-llm@0.5.0');
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal(JSON.stringify(result).includes('private account'), false);
});

test('provider selection does not silently switch paid vendors after an error', async () => {
  let otherCalls = 0;
  const chosen = { status: () => ({ provider: 'boxapi', model: 'm', connection: 'CONFIGURED_UNVERIFIED' }), diagnose: async () => { throw new DiagnosisProviderError('UNAVAILABLE', 'selected provider unavailable'); } };
  const otherPaid = { diagnose: async () => { otherCalls++; } };
  const result = await diagnoseWithFallback(chosen, evidence());
  void otherPaid;
  assert.equal(otherCalls, 0);
  assert.equal(result.fallback.reason, 'UNAVAILABLE');
  assert.equal(result.diagnosis.provider, 'offline');
});

test('malformed model output and unknown evidence IDs are rejected into the deterministic fallback', async () => {
  const input = evidence();
  const provider = new OpenAICompatibleDiagnosisProvider(config({ fetchImpl: async () => ({ ok: true, status: 200, async json() { return { choices: [{ message: { content: JSON.stringify({ diagnosis: 'other', summary: 'x', confidence: 'high', evidenceIds: ['ev_0000000000000000'], repairHint: 'none' }) } }] }; } }) }));
  const result = await diagnoseWithFallback(provider, input);
  assert.equal(result.fallback.reason, 'INVALID_OUTPUT');
  await assert.rejects(() => provider.diagnose({ ...input, items: [{ ...input.items[0], releaseId: 'other-release' }] }), /selected release/i);
  await assert.rejects(() => provider.diagnose({ ...input, items: [{ ...input.items[0], id: 'bad-id' }] }), /evidence item ID/i);
});

test('budget cap is checked before provider transport and owner opt-in is mandatory', async () => {
  let calls = 0;
  const provider = new OpenAICompatibleDiagnosisProvider(config({ maxCostUsd: 0, fetchImpl: async () => { calls++; } }));
  const denied = await diagnoseWithFallback(provider, evidence());
  assert.equal(denied.fallback.reason, 'BUDGET_EXCEEDED');
  assert.equal(calls, 0);
  const noOptIn = createDiagnosisProviderFromEnv({ LIARA_DIAGNOSIS_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'secret', LIARA_OPENROUTER_MODEL: 'm' });
  assert.equal(noOptIn.status().connection, 'OWNER_OPT_IN_REQUIRED');
  const optedIn = await diagnoseWithFallback(noOptIn, evidence());
  assert.equal(optedIn.fallback.reason, 'OWNER_OPT_IN_REQUIRED');
});

test('OpenRouter is pinned to one explicitly selected upstream or is rejected before transport', async () => {
  let calls = 0;
  const provider = new OpenAICompatibleDiagnosisProvider(config({ upstreamProvider: undefined, fetchImpl: async () => { calls++; } }));
  const result = await diagnoseWithFallback(provider, evidence());
  assert.equal(result.fallback.reason, 'UPSTREAM_PROVIDER_REQUIRED');
  assert.equal(calls, 0);
});

test('provider key cannot be redirected to a custom endpoint', () => {
  assert.throws(() => new OpenAICompatibleDiagnosisProvider(config({ baseUrl: 'https://attacker.example/api/v1/' })), /verified official HTTPS origin/i);
  assert.throws(() => new OpenAICompatibleDiagnosisProvider(config({ provider: 'boxapi', baseUrl: 'http://ai.boxapi.ir/ai/v1/' })), /verified official HTTPS origin/i);
});

test('request timeout is explicit and deterministic fallback remains available', async () => {
  const provider = new OpenAICompatibleDiagnosisProvider(config({ timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }) }));
  const result = await diagnoseWithFallback(provider, evidence());
  assert.equal(result.fallback.reason, 'TIMEOUT');
  assert.equal(result.diagnosis.provider, 'offline');
});

test('non-REPLAY live evidence requires exact selected-release provenance', async () => {
  const provider = new OpenAICompatibleDiagnosisProvider(config({ fetchImpl: async () => { throw new Error('must not call'); } }));
  assert.throws(() => makeDiagnosisEvidence({ source: 'LIVE_READ_ONLY', expectedReleaseId: 'release-1', releaseState: 'FAILED', logs: [{ releaseId: 'release-2', signals: ['MODULE_NOT_FOUND'], missingEntrypoint: 'missing.mjs' }] }), /selected release/i);
  const live = makeDiagnosisEvidence({ source: 'LIVE_READ_ONLY', expectedReleaseId: 'release-1', releaseState: 'FAILED', logs: [] });
  const result = await diagnoseWithFallback(provider, live);
  assert.equal(result.diagnosis.diagnosis, 'insufficient_confirmed_evidence');
});

test('Shared token, timeout and transport validation preserves legacy limits', () => {
  for (const override of [
    { maxCompletionTokens: 0 }, { maxCompletionTokens: 4001 }, { maxCompletionTokens: 1.5 },
    { maxCompletionTokens: '4000' }, { timeoutMs: 0 }, { timeoutMs: 120001 }, { fetchImpl: null },
  ]) {
    let legacyMessage;
    assert.throws(() => new OpenAICompatibleDiagnosisProvider(config(override)), error => {
      legacyMessage = error.message; return error instanceof TypeError;
    });
    assert.throws(() => new SharedDiagnosisProvider(config({ requestQuota: { maxAttempts: 3, windowSeconds: 60, maxConcurrent: 1 }, ...override })),
      error => error instanceof TypeError && error.message === legacyMessage);
  }
  const shared = new SharedDiagnosisProvider(config({ maxCompletionTokens: 4000,
    requestQuota: { maxAttempts: 3, windowSeconds: 60, maxConcurrent: 1 } }));
  assert.equal(shared.profile.ceilings.maxOutputTokens, 4000);
});

test('Shared is the provider default; incomplete quota fails closed without transport and legacy is explicit', async () => {
  const paid = { LIARA_DIAGNOSIS_PROVIDER: 'boxapi', LIARA_LLM_OWNER_AUTHORIZED: 'YES', BOXAPI_API_KEY: 'fake-key', LIARA_BOXAPI_MODEL: 'test-model' };
  let calls = 0;
  const missing = createDiagnosisProviderFromEnv(paid, { fetchImpl: async () => { calls++; } });
  assert.equal(missing.status().adapter, 'shared');
  assert.equal(missing.status().connection, 'MISSING_CONFIGURATION');
  assert.equal(missing.status().configuration, 'REQUEST_QUOTA_REQUIRED');
  const result = await diagnoseWithFallback(missing, evidence());
  assert.equal(result.fallback.reason, 'REQUEST_QUOTA_REQUIRED');
  assert.equal(result.diagnosis.origin, 'DETERMINISTIC');
  assert.equal(calls, 0);
  assert.throws(() => new SharedDiagnosisProvider(config()), /explicitly configured request quota/);
  const partial = createDiagnosisProviderFromEnv({ ...paid, LIARA_LLM_MAX_ATTEMPTS: '3' });
  assert.equal(partial.status().configuration, 'REQUEST_QUOTA_REQUIRED');
  assert.match(partial.status().reason, /LIARA_LLM_WINDOW_SECONDS/);
  const invalid = createDiagnosisProviderFromEnv({ ...paid, LIARA_LLM_MAX_ATTEMPTS: '3', LIARA_LLM_WINDOW_SECONDS: '60', LIARA_LLM_MAX_CONCURRENT: 'many' });
  assert.equal(invalid.status().configuration, 'LLM_CONFIGURATION_INVALID');
  const legacy = createDiagnosisProviderFromEnv({ ...paid, LIARA_DIAGNOSIS_ADAPTER: 'legacy' });
  assert.ok(legacy instanceof OpenAICompatibleDiagnosisProvider);
  assert.equal(legacy.status().adapter, 'legacy');
  assert.equal(legacy.status().connection, 'CONFIGURED_UNVERIFIED');
});

test('Shared explicit quota and legacy enforce the same per-request cost and output authority', async () => {
  for (const Provider of [SharedDiagnosisProvider, OpenAICompatibleDiagnosisProvider]) {
    let calls = 0;
    const make = overrides => new Provider(config({ requestQuota: { maxAttempts: 2, windowSeconds: 60, maxConcurrent: 1 },
      fetchImpl: async () => { calls++; return completion(evidence(), { cost: 1 }); }, ...overrides }));
    await assert.rejects(() => make({ maxCostUsd: 0 }).diagnose(evidence()), error => error.code === 'BUDGET_EXCEEDED');
    assert.equal(calls, 0);
    await assert.rejects(() => make({}).diagnose(evidence()), error => error.code === 'REPORTED_BUDGET_EXCEEDED');
    assert.equal(calls, 1);
    await assert.rejects(() => make({ fetchImpl: async () => completion(evidence(), { choices: [{ finish_reason: 'stop',
      message: { content: JSON.stringify({ diagnosis: 'other', summary: 'x', confidence: 'high', evidenceIds: ['unoffered'], repairHint: 'none' }) } }] }) })
      .diagnose(evidence()), error => error.code === 'INVALID_OUTPUT');
  }
});

test('explicit Shared quota retains UNKNOWN attempts and never switches paid providers', async () => {
  let calls = 0;
  const provider = new SharedDiagnosisProvider(config({ requestQuota: { maxAttempts: 1, windowSeconds: 60, maxConcurrent: 1 },
    fetchImpl: async () => { calls++; throw new Error('ambiguous transport'); } }));
  const first = await diagnoseWithFallback(provider, evidence());
  assert.equal(first.diagnosis.provider, 'offline');
  assert.equal(provider.database.prepare('SELECT state FROM starcoach_llm_reservations').get().state, 'unknown');
  const blocked = await diagnoseWithFallback(provider, evidence());
  assert.equal(blocked.fallback.reason, 'BUDGET_EXCEEDED');
  assert.equal(calls, 1);
  assert.equal(provider.database.prepare('SELECT COUNT(*) AS n FROM starcoach_llm_reservations').get().n, 1);
});
