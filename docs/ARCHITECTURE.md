# Architecture

## Implemented recovery MVP

For the supported issue classes, deterministic release-correlated inspection builds a strict `RepairTask` schema `2.0` and passes it to the provider-neutral `proposeRepair()` interface. `FAKE_AGENT` is an in-process offline double. `PROCESS_FAKE_AGENT` starts the fixed `coding-agent-worker.mjs` in a separate Node process using `process.execPath`, bounded JSON stdio, a timeout, a fixed working directory, and a minimal allowlisted environment. The parent verifies worker identity and validates the proposal before it becomes actionable. This proves process transport, not a security sandbox or authentic coding-agent intelligence.

The task binds request/run/generation/operation/release identity, failure type, sanitized evidence IDs, a digest of the minimal allowlisted source snapshot, allowed paths and operations, file/patch limits, timeout, and `REPLAY` provenance. It does not forward raw logs. The proposal must repeat identity and digest, cite evidence, explain the diagnosis and change, and provide exact expected-old and replacement field values. Host validation checks the meaning against current snapshot values before a proposal becomes actionable.

Two synthetic issue classes are supported: a missing startup entrypoint proposes only `package.json:scripts.start`, and an explicit mismatch between `package.json:config.port` and `liara.json:port` proposes the declared contract value. `EADDRINUSE` alone remains manual-only. Conflicting or uncorrelated evidence is ambiguous; insufficient startup source evidence returns `NO_SAFE_REPAIR`. The Persian UI labels the selected incident and fake backend, shows the exact field diff, and marks local approvals as simulated. See [CODING_AGENT_HANDOFF.md](CODING_AGENT_HANDOFF.md) for full contract, offline cases, and current limits.

`BoundedCodingAgentAdapter` defines the future host integration seam and checks exact backend/executable, provider/model, auth method, network allowlist, input/output and attempt/cost budgets, allowed data, and a read-only/cancellable sandbox policy. It uses fixed arguments, no model tools, and semantic response validation. It is deliberately disabled for authentic use until the owner provides separate invocation authorization and the host supplies a trusted sandbox runtime. A child process by itself is not isolation. The app exposes only `FAKE_AGENT` and `PROCESS_FAKE_AGENT` demo modes.

The executable demo is a deterministic local workflow with explicitly separated evidence/action modes:

1. `REPLAY` loads synthetic release and log fixtures. Diagnosis is allowed only when exact evidence and the selected failed release match the supported startup or explicit port-contract case.
2. A bounded proposal changes only the one approved JSON field in a fresh temporary trusted fixture. The user must approve the exact before/after value, target, operation identity, and source snapshot digest; the approval is one-use and becomes stale if the source/evidence changes. The fixture is re-inspected after the edit.
3. `LOCAL_HTTP` starts only the known, dependency-free, fingerprint-checked fixture server and verifies `/healthz` returns HTTP 200 with the expected `liara-recovery-v1` marker. This confirms that local fixture only.
4. A second, distinct user decision gates a `MOCK` deployment provider. Verification checks candidate ID, version, `READY` state, and current status. A failed/non-current candidate does not pass because an older healthy release exists. An ambiguous mock write is returned as `UNKNOWN` and is not retried.

The UI server (`src/demo-server.mjs`) binds to `127.0.0.1` by default and serves the Persian RTL interface. Its default evidence route returns replay fixtures and explicitly reports live evidence disabled. The normal `npm run demo` does not load credentials or contact Liara.

The interface self-hosts Vazirmatn v33.003 Variable WOFF2 from `assets/fonts/Vazirmatn-Variable.woff2` with its OFL 1.1 license. The server exposes that one exact path as `font/woff2` with `nosniff`; there is no directory handler, path parameter, CDN, or Google Fonts import. The CSS declares `font-weight: 100 900` and `font-display: swap`, applies regular/control/heading weights, keeps `system-ui` as the fallback, and uses a local monospace stack for evidence and code blocks.

## Run, generation, and operation isolation

`GET /api/state` returns a `serverInstanceId`, the current `runId`, and a monotonically increasing `generation` for this server process. Every POST mutation, including REPLAY/LIVE diagnosis requests, must provide those three expected identity values, a unique UUID `operationId`, and an exact action-specific `payload` object. Missing or extra envelope/payload keys fail closed; wrong server, run, or generation returns HTTP 409 with a stable code. An operation ID can be used once. The bounded in-memory registry stores up to 4,096 attempts and refuses further mutations when full; it is not durable across process restart and is not a cloud-grade idempotency ledger.

Reset claims a server-local lock before creating a replacement workflow. Its linearization point is the synchronous assignment of that replacement together with the generation increment. Only one Reset based on a given identity can win. Other mutations are refused while Reset is preparing. Reset also refuses while any mutation is active; its asynchronous continuation checks that the original session and generation still own the workflow before committing. Closing the local server waits for active mutations before disposing the current temporary fixture.

The browser binds each mutation to the identity it rendered and ignores responses from an older generation/run, another server instance, or an earlier request that arrives after a newer mutation response. This protects the page from out-of-order HTTP responses; it does not provide cross-process persistence.

If a mock deployment returns `UNKNOWN`, its unresolved run/operation is carried across Reset in the current server process and shown in the UI. Further mock deployment attempts fail with `UNKNOWN_REQUIRES_RECONCILIATION` until the operator reconciles externally; this demonstrator has no automatic reconciliation action. Reset does not retry that deployment or assert that dispatch never occurred. The in-memory marker is lost on server restart, so this behavior is a local safeguard rather than durable cloud recovery.

## GET-only Liara adapter (not live-verified)

`src/liara-readonly.mjs` implements Bearer-authenticated GET requests for project details, v1 release listing, documented v1 logs, and CLI-compatible v2 release-filtered logs. `src/liara-readonly-preflight.mjs` requires both an explicit local configuration flag and `LIARA_READONLY_OWNER_AUTHORIZED=YES`, plus a locally supplied `LIARA_READONLY_TOKEN`, named team/project/release, and a time window of at most six hours. It produces allowlisted evidence and maps transport ambiguity to `UNKNOWN`.

The release-filtered v2 log route is based on the public CLI contract, not the documented PaaS v1 OpenAPI logs operation. Its compatibility and account permissions have not been verified against an authenticated Liara account. The time-window end is filtered locally because the CLI log contract does not document an `until` parameter. Source-to-release correspondence is always `UNCONFIRMED`. No authenticated request or cloud write has been made.

## Optional provider-backed diagnosis

`src/diagnosis-providers.mjs` defines a common provider interface for deterministic offline diagnosis, BoxAPI, OpenRouter, and an explicit unavailable status for `openai_chatgpt_plan`. Provider selection is independent; paid providers require their own key, model, owner opt-in, model-specific rates and estimated request cap. `/api/diagnose` accepts the current normalized replay evidence. `/api/live-diagnosis` collects the configured GET-only evidence first and requires confirmed release-log attribution and a selected release ID. Provider history: two earlier BoxAPI requests returned HTTP 403 (cause `UNKNOWN`, recorded in `BOXAPI_403_TROUBLESHOOTING.md`); no successful real inference has been verified, and no provider request was made in the latest audit. All adapter behavior is verified only with injected fake transports.

Both active adapters use their documented chat-completions shape and locally validate a fixed JSON schema and each cited evidence ID against the selected release. OpenRouter requests require one configured upstream slug and send it in `provider.only` with `allow_fallbacks=false`, disabling its default multi-provider routing/failover. Only allowlisted normalized evidence is sent. A model can return an advisory enum, never an executable command or approval. Provider failure is returned with deterministic fallback metadata; the application does not silently route to another paid provider. The cost guard is an estimated per-request check based on configured model rates and a character/token approximation, not an account-level cap; it reports usage/cost only where the upstream response includes them. See [`LLM_DIAGNOSIS_PROVIDERS.md`](LLM_DIAGNOSIS_PROVIDERS.md).

The Liara v2 log normalizer accepts Unix seconds, milliseconds, microseconds, nanoseconds, and ISO timestamps for range filtering. Raw timestamp text remains bounded output metadata; normalized diagnosis evidence receives a stable synthetic evidence ID and is validated against the selected release ID.

## Approval and data-integrity boundaries

The digest below is a content fingerprint, not proof of human consent. In the demo, consent is represented by distinct UI actions and exact action digests; this is a local demonstrator, not a persistent identity-bound approval service. Do not infer a LIVE write path from this demo or adapter.

Deterministic static Node repository checks → evidence-backed findings → SHA-256 approval digest over canonical action fields → local mock deployment provider → mock candidate-state checks. The mock can model a failed or non-current candidate; it does not verify a real Liara release.

Repository inspection reports missing optional `liara.json` as acceptable, but reports invalid or unreadable files and invalid structures as errors. A present config must include an integer `port` from 1 through 65535; other settings are marked unsupported until the contest contract is confirmed. Inspection never executes repository code.

The approval digest is computed from a captured JSON-compatible action tree and recomputed immediately before the mock write. The provider executes only that same recursively frozen snapshot; it never rereads action fields from the caller's plan after checking approval. Top-level legacy `plan.hash` is ignored. Inputs must be inert data (normally output from `JSON.parse`): JavaScript cannot reliably identify every Proxy, and capture can invoke Proxy traps. A Proxy may affect or fail capture, but it cannot mutate the captured action after its digest is checked; if it produces different data when the digest is approved and when deployment captures it, approval fails. Accessors, sparse arrays, symbols, non-enumerable fields, non-finite numbers, and arrays with extra properties are rejected. This local boundary is not a substitute for an authenticated, persistent approval system.

Repository metadata reads are limited to regular `package.json` and `liara.json` files at the resolved project root, each at most 256 KiB. Symlinks and non-regular files are rejected, the opened file identity is checked against the initial `lstat`, and its resolved path is checked to remain below the project root before reading. A filesystem actor able to replace paths concurrently can still create platform-dependent race windows, especially where `O_NOFOLLOW` is unavailable; inspection is not a general filesystem sandbox. Findings may include a bounded, control-character-sanitized unsupported setting name, but do not include configuration values. All deployment and release states are synthetic mock behavior; live Liara release verification is not implemented.

Preparation-only boundaries and unresolved contracts are listed in `OPEN_QUESTIONS.md`. The runtime has no dependency on sibling folders or the central research archive. Runtime code uses Node built-ins plus the pinned vendored `@starcoach/core-llm` 0.5.0 package, installed from `vendor/` through the committed lockfile. The provider adapters are opt-in and are not exercised by the default recovery demo.

## Diagnosis request path and local server guard

```
UI button → POST /api/diagnose | /api/live-diagnosis
  → RecoveryWorkflow.diagnosisEvidence() (REPLAY) or sanitized GET-only evidence (LIVE READ-ONLY)
  → makeDiagnosisEvidence(): stable `ev_…` ids, release binding, allowlisted fields
  → diagnoseWithFallback(provider)
      → provider.diagnose(): prepareProviderRequest() fails closed on bad evidence, missing key/model,
        missing OpenRouter upstream, unset rates, or an over-cap estimate — before any transport
      → SharedDiagnosisProvider: @starcoach/core-llm client.generate()  (legacy adapter is an explicit rollback)
      → validateDiagnosis(): exact schema, evidence ids must belong to the selected release
  → UI shows origin (DETERMINISTIC | PROVIDER), adapter, SDK, requested/returned model, transport mode, fallback reason
```

`createDiagnosisProviderFromEnv` defaults to the offline deterministic provider. A paid provider also needs `LIARA_LLM_OWNER_AUTHORIZED=YES`, and the Shared adapter needs an explicit request quota; incomplete configuration yields an `InvalidConfigurationDiagnosisProvider` that sends nothing. Blank numeric variables are treated as missing, not zero. There is no automatic switch to another provider; a provider failure is shown beside the deterministic result.

`src/demo-server.mjs` accepts only loopback `Host` headers, rejects any `Origin` that is not the page's own origin, and requires `application/json` for POST bodies. This stops DNS-rebinding and cross-site form posts from driving the approval routes. `RecoveryWorkflow` also refuses a second concurrent deployment request, so a single approval can reach the provider write at most once.
