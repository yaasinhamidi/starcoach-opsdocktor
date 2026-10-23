# Optional LLM diagnosis providers

The deterministic diagnosis remains the default and works offline. The LLM path is an optional advisory layer over normalized evidence. It cannot authorize a repair or deployment, select shell commands, or execute model output. Repair and mock deployment continue to require their separate local decisions.

## Provider selection

Set `LIARA_DIAGNOSIS_PROVIDER` to exactly one of `offline`, `boxapi`, `openrouter`, or `openai_chatgpt_plan`. Provider-backed diagnosis uses the installed Shared SDK adapter by default; `LIARA_DIAGNOSIS_ADAPTER=legacy` is an explicit rollback only. There is no automatic paid-provider switching. A selected provider failure is returned alongside a deterministic offline diagnosis and its explicit fallback reason.

The Shared adapter requires all three request-quota settings: `LIARA_LLM_MAX_ATTEMPTS`, `LIARA_LLM_WINDOW_SECONDS`, and `LIARA_LLM_MAX_CONCURRENT`. If any is missing or invalid, startup returns a `MISSING_CONFIGURATION` status with `configuration: REQUEST_QUOTA_REQUIRED` or `LLM_CONFIGURATION_INVALID`; diagnosis then returns the deterministic fallback and sends no provider request. The quota is app-local and in-memory.

The BoxAPI and OpenRouter adapters use their documented chat-completions endpoint and provider-specific model name. BoxAPI's current general AI page documents `https://ai.boxapi.ir/ai/v1/chat/completions`; another BoxAPI text-to-text page documents `/api/v1/chat/completions`. `LIARA_BOXAPI_BASE_URL` can select the documented base appropriate to the account. OpenRouter's default base is `https://openrouter.ai/api/v1/`. OpenRouter normally load-balances across upstream providers and may fail over; this adapter requires `LIARA_OPENROUTER_UPSTREAM_PROVIDER` and sends `provider.only=[that provider]` plus `allow_fallbacks=false` to pin one upstream and disable failover. OpenRouter/model/upstream provider are configured separately.

Configure keys only in the local process environment:

```powershell
$env:LIARA_DIAGNOSIS_PROVIDER = 'openrouter'
$env:LIARA_LLM_OWNER_AUTHORIZED = 'YES'
$env:OPENROUTER_API_KEY = '<local key>'
$env:LIARA_OPENROUTER_MODEL = '<provider-specific model id>'
$env:LIARA_OPENROUTER_UPSTREAM_PROVIDER = '<exact OpenRouter provider slug>'
$env:LIARA_OPENROUTER_INPUT_USD_PER_MILLION = '<verified model rate>'
$env:LIARA_OPENROUTER_OUTPUT_USD_PER_MILLION = '<verified model rate>'
$env:LIARA_LLM_MAX_REQUEST_COST_USD = '<owner-selected cap>'
$env:LIARA_LLM_MAX_ATTEMPTS = '1'
$env:LIARA_LLM_WINDOW_SECONDS = '60'
$env:LIARA_LLM_MAX_CONCURRENT = '1'
npm run demo
```

Use `BOXAPI_API_KEY`, `LIARA_BOXAPI_MODEL`, `LIARA_BOXAPI_INPUT_USD_PER_MILLION`, and `LIARA_BOXAPI_OUTPUT_USD_PER_MILLION` for BoxAPI. Do not place key values in configuration files, browser requests, source, or logs. The server status route exposes the provider, model, adapter, SDK identity, configured limits, and setup state, but never credentials. Live provider requests happen only after an explicit POST to `/api/diagnose` (REPLAY input) or `/api/live-diagnosis` (which also requires the existing owner-gated Liara read-only setup). Successful provider results expose `origin: PROVIDER`, the adapter/SDK, requested and returned model, HTTP status, latency and usage; failures return `origin: DETERMINISTIC` plus the sanitized fallback reason.

The request uses an estimated maximum cost guard: input tokens are roughly approximated from serialized input length and output tokens are bounded by `LIARA_LLM_MAX_COMPLETION_TOKENS` (default 500). The owner must supply current model-specific rates and a request cap. Providers may account differently, and actual pricing/usage is not verified here. Returned usage/cost is reported when present; if a reported cost exceeds the cap, the result is withheld, though the upstream request may already have incurred that charge. This is not a cumulative account budget.

Model structured-output support is not assumed. The adapter requests plain JSON text, parses it locally, and requires an exact schema, enumerated diagnosis and advisory repair hint, and evidence IDs that exist in the selected release. Invalid output is rejected. Evidence passed to a model is reduced to allowlisted release ID, normalized timestamp, signal codes, bounded entrypoint marker, and release state; raw log text, secrets, paths, and environment values are omitted.

## Single-request BoxAPI acceptance harness (not executed)

The candidate real-inference check is `scripts/boxapi-one-shot.mjs`, invoked through a hidden-input PowerShell wrapper. It constructs `SharedDiagnosisProvider` directly with a fixed synthetic REPLAY incident, one allowed HTTP attempt, no retry, no fallback provider, and quota of one request per 60 seconds at concurrency one.

Offline preflight (no key, no request):

```powershell
npm run llm:acceptance-preflight
```

The preflight reports provider `boxapi`, adapter `shared`, SDK `@starcoach/core-llm@0.5.0`, endpoint `https://ai.boxapi.ir/ai/v1/chat/completions`, requested model `openai/gpt-4.1-mini`, credential source `BOXAPI_API_KEY` (presence boolean only), timeout 20s, output limit 300 tokens, an input upper bound of 1,500 tokens, the request quota, and a maximum cost at those bounds of `$0.001242` against a `$0.02` cap. These are pricing estimates, not a guaranteed billing cap.

Execution requires the explicit `-Approved` switch and prompts for the key with hidden input:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-boxapi-one-shot.ps1 -Approved
```

The wrapper sets `LIARA_LLM_ACCEPTANCE_APPROVED=YES`, `LIARA_LLM_OWNER_AUTHORIZED=YES`, and `LIARA_DIAGNOSIS_PROVIDER=boxapi` only in the child process. The script blocks before transport if any gate, provider selection, adapter selection, or key is missing. No real-provider command has been run in this workspace; BoxAPI model entitlement and account permission remain `UNKNOWN` until the owner runs it.

## Installed SDK audit (2026-10-22, local only)

`npm ls @starcoach/core-llm` resolves the vendored tarball as `@starcoach/core-llm@0.5.0`; `package-lock.json` records the same version, `file:vendor/starcoach-core-llm-0.5.0.tgz` resolution, and tarball integrity. OpsDocktor imports only that package and Node built-ins, not the sibling `shared/` source tree.

The installed SDK exposes three provider identifiers: `openai_api`, `openrouter`, and `boxapi`. OpsDocktor routes provider-backed `openrouter` and `boxapi` diagnosis through the Shared adapter by default, retains legacy only as an explicit rollback, and keeps deterministic `offline` as the default provider. The SDK exports `OAuthSession` and `CredentialStore` names, but their methods are stubs that throw `adapter is not installed`; there is no ChatGPT/Codex OAuth adapter or Codex app-server transport in the installed SDK. OpsDocktor deliberately maps `openai_chatgpt_plan` to `UNAVAILABLE_ADAPTER`.

This audit made no provider or account request. The adapters remain verified only with mocked transports, and no real model response or authenticated inference has been verified.

## OpenAI / Codex status

`openai_chatgpt_plan` currently reports `UNAVAILABLE_ADAPTER` and retains the deterministic fallback. OpenAI's official Sign in with ChatGPT documentation describes an open-source/local client authorization flow for optional ChatGPT-plan inference, distinct from identity scopes. It requires dynamic client registration, a loopback callback, PKCE/state/nonce, consent to plan-usage scopes, ID-token/scope validation, token storage/refresh, and a separate supported inference request or Codex app-server integration. This repository does not implement that OAuth lifecycle, and no OAuth consent was initiated. Identity-only sign-in must not be treated as inference access. The official documentation separately directs paid or remotely hosted apps to an interest form; this does not establish eligibility for a hosted Liara service.

## Verification and evidence labels

Local evidence labels are `SDK_CONNECTED` (the installed package resolves and `createProviderClient` is invoked), `MOCK_TRANSPORT_TESTED` (fake transports only), and `REAL_INFERENCE_NOT_TESTED`. No real API key was read, and no provider API request was made. `LIVE_LLM` is an evidence label for an actual successfully completed provider request; configuration alone is `CONFIGURED_UNVERIFIED`, and provider status reports `NOT_RUN`. `REAL_INFERENCE_VALIDATED` must not be used without a genuine schema-validated provider response. `REPLAY`/`LIVE_READ_ONLY` describe the input evidence source, `LOCAL_HTTP` describes local health checks, `MOCK` describes simulated calls/deployment, and `LIVE_DEPLOY` is not implemented.

Official contracts reviewed:

- BoxAPI AI API: <https://boxapi.ir/docs/ai/> and <https://boxapi.ir/docs/ai/text-to-text/>.
- OpenRouter chat completions and provider routing: <https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion> and <https://openrouter.ai/docs/guides/routing/provider-selection>.
- OpenAI Sign in with ChatGPT: <https://developers.openai.com/siwc/token-sharing-open-source>, <https://developers.openai.com/siwc/token-sharing-open-source/sign-in>, and <https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server>.
