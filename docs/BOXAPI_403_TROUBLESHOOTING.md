# BoxAPI HTTP 403 troubleshooting

## Captured evidence

The local terminal transcript available during troubleshooting contains **two** separate `LIVE_LLM_FAILED` outputs. Each reports one request attempt, HTTP 403, the BoxAPI `/ai/v1/chat/completions` endpoint, requested model `openai/gpt-4.1-mini`, `REPLAY` evidence, and `max_tokens: 300`. Their reported latencies are 871 ms and 455 ms. This conflicts with the report that only one request was attempted. Treat the authorization as consumed; do not retry without new owner authorization.

The outputs contain no response ID, returned model, provider error code, response body, input/output usage, or provider-reported cost. The original adapter threw immediately for non-2xx responses and discarded the body. No response body is available to recover. The printed $0.001242 was a pre-request maximum estimate, not actual usage or a guaranteed billing cap. Whether either rejected request incurred a charge is unknown.

The actual request body and credential were not logged. Offline mock tests verify the construction: POST `https://ai.boxapi.ir/ai/v1/chat/completions`, `Authorization: Bearer <credential>`, JSON with model, system/user messages containing synthetic REPLAY evidence, `temperature: 0`, and `max_tokens: 300`. The runner calls only the selected BoxAPI adapter directly; it does not switch to another paid provider.

## Owner dashboard checks

Inspect the BoxAPI account and its AI API request history. Do not paste the key or raw account response into chat or repository files.

1. **Key type and status:** confirm the credential is an AI API key, not a key for another BoxAPI product; confirm it is active and not revoked or expired.
2. **AI eligibility and credit:** confirm the account is eligible to use AI API, has remaining AI credit, and has no billing, trial, or quota restriction.
3. **Model entitlement:** confirm `openai/gpt-4.1-mini` is enabled for this account. Public catalog listing does not prove account-level access.
4. **Endpoint permission:** confirm the account is authorized for `https://ai.boxapi.ir/ai/v1/chat/completions`. Do not switch to `/api/v1` unless BoxAPI confirms the account should use it.
5. **Account or regional policy:** check any account verification, region, network/IP, or service policy restrictions that can produce HTTP 403.
6. **Request history/support:** search around the time of the two terminal events (latencies 871 ms and 455 ms). Obtain the provider-side reason and request IDs, if the dashboard retained them. The local output contains no request ID.

## Evidence-based ranking and unknowns

The endpoint and model identifier used by the runner match the selected public configuration, and mock tests confirm the request shape. Therefore key type/status, AI account entitlement/credit, and account-level model/endpoint permission are the first checks. This is a troubleshooting order, not a diagnosis: because the response body was discarded, the available 403 evidence cannot distinguish these causes. Regional restrictions remain possible. A rejected `max_tokens` parameter is less suggested by an HTTP 403 but is not ruled out without BoxAPI's provider-side reason.

## Before any further inference authorization

First record the dashboard/support result for key status, AI credit eligibility, model entitlement, endpoint permission, and regional/account policy. Ask BoxAPI for the rejection reason and request ID(s) from the provider-side logs if available, and confirm that `max_tokens: 300` is accepted and enforced for this model/endpoint. Preserve the distinction between public model listing, account access, and a successful live inference. Any further request requires fresh, explicit owner authorization with a request count and cost ceiling; do not reuse the consumed authorization.
