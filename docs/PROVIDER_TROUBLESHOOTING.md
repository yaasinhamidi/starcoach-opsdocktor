# LLM provider setup and troubleshooting

Liara defaults to deterministic offline diagnosis. Select exactly one provider with `LIARA_DIAGNOSIS_PROVIDER=offline|boxapi|openrouter|openai_chatgpt_plan`. Provider-backed diagnosis uses the installed Shared SDK adapter by default; `LIARA_DIAGNOSIS_ADAPTER=legacy` is an explicit rollback only. No credentials are needed for `offline`; paid adapters require a separate `LIARA_LLM_OWNER_AUTHORIZED=YES` opt-in and a complete request quota. A provider error returns the offline result with an explicit fallback reason. The adapter never silently chooses another paid provider.

## Local configuration

Set environment variables only in the local process that starts the demo. Never place keys in repository files, browser requests, screenshots, or logs.

| Provider | Required local variables | Notes |
|---|---|---|
| BoxAPI | `BOXAPI_API_KEY`, `LIARA_BOXAPI_MODEL`, `LIARA_BOXAPI_INPUT_USD_PER_MILLION`, `LIARA_BOXAPI_OUTPUT_USD_PER_MILLION`, `LIARA_LLM_MAX_REQUEST_COST_USD` | Default base is `https://ai.boxapi.ir/ai/v1/`. Check the account dashboard for AI-key status, credit eligibility/balance, model access, endpoint permission, and regional/account restrictions. A 403 is surfaced as a sanitized permission/authentication failure; it does not establish which access condition failed. |
| OpenRouter | `OPENROUTER_API_KEY`, `LIARA_OPENROUTER_MODEL`, `LIARA_OPENROUTER_UPSTREAM_PROVIDER`, `LIARA_OPENROUTER_INPUT_USD_PER_MILLION`, `LIARA_OPENROUTER_OUTPUT_USD_PER_MILLION`, `LIARA_LLM_MAX_REQUEST_COST_USD` | Adapter pins the configured upstream and disables upstream fallbacks. Verify model/upstream availability and current rates in the account dashboard. |
| OpenAI ChatGPT-plan / Codex | none supported by this adapter | `openai_chatgpt_plan` reports `UNAVAILABLE_ADAPTER`. Identity sign-in is not plan-inference authorization. No OAuth flow is implemented or initiated. |

For either paid API adapter also set `LIARA_LLM_OWNER_AUTHORIZED=YES` only after the owner approves provider, model, request purpose, rate values, and maximum per-request cost. The Shared adapter requires `LIARA_LLM_MAX_ATTEMPTS`, `LIARA_LLM_WINDOW_SECONDS`, and `LIARA_LLM_MAX_CONCURRENT` together; missing or invalid values fail closed with `MISSING_CONFIGURATION` and no request. Optional controls: `LIARA_LLM_TIMEOUT_MS`, `LIARA_LLM_MAX_COMPLETION_TOKENS`, and provider-specific `LIARA_BOXAPI_BASE_URL` / `LIARA_OPENROUTER_BASE_URL`. Model names, rates, eligibility, and limits differ by provider; recheck them before enabling. A local estimate is not a guaranteed provider billing cap.

PowerShell example with placeholders (enter actual values locally; do not paste them into chat):

```powershell
$env:LIARA_DIAGNOSIS_PROVIDER = 'boxapi'
$env:LIARA_LLM_OWNER_AUTHORIZED = 'YES'
$env:BOXAPI_API_KEY = '<set locally>'
$env:LIARA_BOXAPI_MODEL = '<dashboard model id>'
$env:LIARA_BOXAPI_INPUT_USD_PER_MILLION = '<current rate>'
$env:LIARA_BOXAPI_OUTPUT_USD_PER_MILLION = '<current rate>'
$env:LIARA_LLM_MAX_REQUEST_COST_USD = '<owner cap>'
$env:LIARA_LLM_MAX_ATTEMPTS = '1'
$env:LIARA_LLM_WINDOW_SECONDS = '60'
$env:LIARA_LLM_MAX_CONCURRENT = '1'
npm run demo
```

Diagnosis is sent only when a user explicitly presses one of the UI diagnosis buttons (`/api/diagnose` for REPLAY or `/api/live-diagnosis` after owner-gated Liara reads). Do not use a paid provider in a recording unless the owner intends that request and has verified its cost. The default UI remains offline.

## Troubleshooting

- `OWNER_OPT_IN_REQUIRED`: set the owner opt-in only after the scoped approval above.
- `MISSING_CREDENTIAL` / connection unavailable: confirm the correct provider-specific variable exists in the demo process environment; never echo the value.
- HTTP 401/403: inspect key type/status, plan or credit eligibility/balance, model access, endpoint permission, and account/region restrictions in the provider dashboard. The app does not retry, switch providers, or reveal the raw response body.
- timeout / network failure: status is unknown; do not infer provider rejection or retry automatically.
- invalid schema / evidence IDs: model output was rejected; inspect sanitized status and use deterministic diagnosis.
- reported cost above cap: output is withheld, but the provider may already have charged for the request. The local estimate is per request, not cumulative.

## Evidence labels

`REPLAY` and `LIVE_READ_ONLY` identify input evidence provenance. `MOCK` means an injected test provider; `LIVE_LLM` is only an actually completed paid-provider inference. `LOCAL_HTTP` is local fixture health. `UNKNOWN` means the outcome could not be established. None of these labels means `LIVE_DEPLOY`; live write operations are not implemented.
