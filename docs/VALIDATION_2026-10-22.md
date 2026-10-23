# Local validation record — 2026-10-22

> **Current-root note (added in the final readiness pass):** this application directory is now `D:\Hackathons\Starcoach\Agentic-AI-2026\apps\opsdocktor`. Earlier sections below were recorded at a pre-rename path and are preserved as history. The final section records the current workspace.

## Environment and commands

- Workspace and Git root: `D:\Hackathons\Starcoach\Agentic-AI-2026\challenges\liara`.
- Git HEAD at validation start: `96239d4af8775dea91ef83a192aa0dbe8751a811`; working tree already contained modified and untracked implementation files.
- Node: `v24.16.0`; npm: `11.18.0`.
- `npm test` after adding denial/failure route and timeout coverage: **38 passed, 0 failed, 1 skipped**. The skipped symlink-isolation test reports `EPERM` creating a symlink on this host.
- `npm run smoke`: **passed**. Output identifies the check as offline `MOCK`; no Liara integration.
- `npm run package:submission`: created the ignored `submission-package/` copy with 41 files. From that package, `npm test` returned **38 passed, 0 failed, 1 skipped**, and `npm run smoke` passed.
- The package's Markdown relative links passed. Its file inventory matched the GitHub publication manifest exactly.

## Demo evidence

- Port 4173 was already listening. Its process was identified as `node src/demo-server.mjs` from this repository; it was reused and not stopped.
- A local GET of `http://127.0.0.1:4173/` returned HTTP 200 and `text/html; charset=utf-8`. The response included the Persian recovery UI and the `REPLAY + MOCK` badge.
- Automated `tests/recovery.test.mjs` passed replay-correlated diagnosis and repair, repair/deployment denial, separate approval gates, local fixture health check, success/failed/non-current/unknown mock outcomes, reset, and live-read-only UI status routes.
- `tests/liara-readonly.test.mjs` passed mock GET contract, sanitizer, error/unknown, selected time-bound, and configured-timeout checks.
- Browser content inspection and screenshot capture were not performed: the in-app browser origin approval gate declined access to `http://127.0.0.1:4173`. No workaround was attempted. Therefore no direct visual/accessibility review of the open page is claimed.
- Labels: fixture evidence is `REPLAY`; fixture HTTP health is `LOCAL_HTTP`; deployment outcomes are `MOCK`; no `LIVE` result exists.

## Liara preflight

No authenticated or unauthenticated Liara API request was made. No credential was read or supplied. The owner-gated preflight is covered by tests with injected mock adapters only. The v2 release-filtered log contract and account permissions remain unverified.

## Provider and provenance increment (same workspace, after baseline record)

- `npm test`: **53 passed, 0 failed, 1 skipped**. The skip remains the host's `EPERM` symlink restriction. Test discovery is explicitly limited to `tests/*.test.mjs` to avoid executing duplicate tests in the preserved nested submission copy.
- `npm run smoke`: **passed**, offline `MOCK` only.
- Provider tests use injected mock transports only: provider switching, independent model/key selection, missing credentials, provider errors/no paid failover, malformed schema/evidence IDs, timeout, estimated cap check, BoxAPI/OpenRouter request shapes, OpenAI adapter unavailable state, and explicit `MOCK` labels.
- Liara log timestamp regression includes a nanosecond fixture and confirms normalized range filtering. A mocked `LIVE_READ_ONLY` route test confirms sanitized evidence reaches the diagnosis provider with matching selected-release provenance. No authenticated Liara request was made.
- Repair denial revocation, deployment-denial revocation, and competing apply attempts are covered by regression tests.
- `npm run package:submission -- submission-package-ready` created a separate ignored curated package with **44 files**, preserving the prior `submission-package/` unchanged. Inside `submission-package-ready/`, `npm test` returned **53 passed, 0 failed, 1 skipped** and `npm run smoke` passed.
- Provider APIs were not called; no credentials were read, no OAuth consent was initiated, and no Liara account was contacted. There is no `LIVE_LLM`, `LIVE_READ_ONLY`, or `LIVE_DEPLOY` result from this increment.

## Final read-only readiness pass (2026-10-22)

- Root confirmed as `D:/Hackathons/Starcoach/Agentic-AI-2026/challenges/liara`; pre-existing tracked modifications and untracked files were preserved.
- Targeted Liara adapter/UI tests: **30 passed, 0 failed**. Coverage includes project identity mismatch, response-size and timeout bounds, provider error-code redaction, duplicate release-tag handling, nanosecond conversion, and UI controls/labels.
- Full current repository: `npm test` **60 passed, 0 failed, 1 skipped** (`EPERM` for symlink creation); `npm run smoke` passed.
- Fresh curated package `submission-package-final-readonly/`: **45 manifest entries**; its `npm test` **60 passed, 0 failed, 1 skipped**, and `npm run smoke` passed.
- A new local demo server on port 4174 returned HTTP 200. The page contained provider status plus REPLAY and LIVE_READ_ONLY diagnosis controls and the LIVE_LLM label. `/api/llm-status` showed the default `offline` / `AVAILABLE` state. No provider or Liara action was triggered.
- All Liara transport results used mocked responses. No Liara API or LLM provider request was made; no `LIVE_READ_ONLY` or `LIVE_LLM` evidence was produced.
- No video was created or playback-verified. No remote is configured and no publication or contest submission occurred.

## Final submission-readiness validation (current workspace)

- Workspace and Git root: `D:/Hackathons/Starcoach/Agentic-AI-2026/apps/opsdocktor`; branch `main`; HEAD `96239d4af8775dea91ef83a192aa0dbe8751a811`. The pre-existing modified and untracked files were preserved.
- Environment: Node `v24.16.0`, npm `11.18.0`, Windows `10.0.26300`.
- `npm test` exited **0**: **80 tests, 79 passed, 0 failed, 1 skipped**. The skip is the host's `EPERM` restriction on symlink creation, not an application failure.
- `npm run smoke` exited **0**: offline `MOCK` only.
- `node scripts/verify-liara-test-app.mjs` exited **0** with `externalRequests: 0`: healthy baseline `LOCAL_HTTP` 200; intentional startup failure `PASS` with exit 1 and `MODULE_NOT_FOUND`; corrected startup `LOCAL_HTTP` 200. This reproduces the failure outside the replay UI.
- `node src/demo-server.mjs` on port 4177 served HTTP 200 with the Persian `REPLAY + MOCK` page, `LIVE READ-ONLY`, `LOCAL HTTP`, `LIVE_LLM`, and the repair/deployment controls. The server was stopped after the check.
- The in-app browser loaded the demo and exercised the visible sequence: inspect → diagnosis and exact diff → reject repair → reset/inspect → approve repair → apply → `LOCAL HTTP VERIFIED` (HTTP 200, `liara-recovery-v1`) → separate deployment approval → `MOCK` success with candidate ID, version `recovery-v2`, `READY`, and current state. The browser accessibility tree confirmed the visible labels. Screenshot capture was unavailable because the in-app browser surface was hidden; no screenshot is claimed.
- A separate loopback API run confirmed repair rejection leaves `localHttpHealth` at `NOT_RUN`; apply without approval and deploy without a separate approval are refused; the unknown scenario returns `UNKNOWN` and a second deploy is refused; `/api/live-evidence` returns `UNAVAILABLE` without credentials.
- Curated package isolation: `submission-package-offline-6f3c2587-1ac1-4530-b72d-6877049b091d` was copied outside the repository. Before installation, importing `@starcoach/core-llm` failed with `ERR_MODULE_NOT_FOUND`; `npm ci --offline --ignore-scripts` then installed one local package, `@starcoach/core-llm` 0.5.0, with an empty npm cache and no registry access. From that isolated package, `npm test` exited 0 with the same 80/79/0/1 result, `npm run smoke` passed, and the demo served `REPLAY + MOCK` with the `offline` provider. This confirms the package resolves the pinned tarball independently of the parent `node_modules`.
- No authenticated Liara request, cloud write, paid LLM request, credential read, Git commit, push, publication, video, or contest submission occurred. No `LIVE_READ_ONLY`, `LIVE_LLM`, or `LIVE_DEPLOY` evidence exists.
- Labels: `REPLAY` fixture evidence; `LOCAL_HTTP` loopback fixture health; `MOCK` simulated deployment/candidate state; `UNKNOWN` ambiguous outcome with no automatic retry.

## Vazirmatn UI increment (2026-10-22)

- Official source: rastikerdar/vazirmatn release `v33.003`; archive `vazirmatn-v33.003.zip` SHA-256 `0a9afd41967e6f57096a56a181a23f81a2b999b62f1f2a4e4b26736580854fdb`.
- Extracted `fonts/webfonts/Vazirmatn[wght].woff2` to `assets/fonts/Vazirmatn-Variable.woff2`; SHA-256 `4e3fa217d38fdafc1fea4414ceb58ca5e662cf0ab5fa735a8c8c20e8b42cad92`; WOFF2 signature and internal version verified. The release archive's `OFL.txt` (SIL OFL 1.1) is stored unchanged at `assets/fonts/OFL.txt` with SHA-256 `17e355067c8284f47743a1ee3b1ef7ff684ff0601eda357f9353b10b3016ab31`.
- `npm test` exited **0**: **80 tests, 79 passed, 0 failed, 1 skipped** (`EPERM` symlink restriction). `npm run smoke` exited **0** with offline `MOCK` only.
- The demo served the font at `/assets/fonts/Vazirmatn-Variable.woff2` with HTTP 200, `content-type: font/woff2`, `content-length: 111152`, `x-content-type-options: nosniff`; the served bytes matched the pinned SHA-256. A missing font path returned 404, and the server exposes no directory handler.
- The in-app browser loaded the face: `document.fonts.status` and the Vazirmatn face were `loaded`, `font-weight: 100 900`, body weight 400, control weight 500, card headings 600, page heading 700, and `dir=rtl`. Resource timing showed one local WOFF2 request and **no external request**.
- The visible recovery flow remained functional after the font change: inspect → reject repair (`REPAIR_DECLINED`, health `NOT_RUN`) → reset/inspect → approve/apply (`LOCAL_HTTP VERIFIED`, HTTP 200, `liara-recovery-v1`) → separate deployment approval → `MOCK` `SUCCESS` for `candidate-1`, `recovery-v2`, `READY`, current. The final result explicitly remained `MOCK`, not a Liara deployment. Screenshot capture was unavailable because the browser surface was hidden; no screenshot is claimed.
- SDK audit made no provider request: installed `@starcoach/core-llm@0.5.0` resolves from `vendor/starcoach-core-llm-0.5.0.tgz`, and the lockfile records the same version/resolution/integrity. The SDK exports `openai_api`, `openrouter`, and `boxapi` provider identifiers; its `OAuthSession` and `CredentialStore` methods are stubs that throw `adapter is not installed`, and no ChatGPT/Codex OAuth or app-server adapter is present. OpsDocktor wires `openrouter`/`boxapi` plus deterministic `offline`, and reports `openai_chatgpt_plan` as `UNAVAILABLE_ADAPTER`. No real model response or authenticated inference exists.
- New release candidate: `submission-package-offline-release-vazirmatn/` with 51 manifest entries, including `assets/fonts/Vazirmatn-Variable.woff2`, `assets/fonts/OFL.txt`, and `assets/fonts/README.md`. Its isolated-install, test, smoke, font-hash, and no-external-request checks are recorded in the final readiness handoff.
- No authenticated Liara request, cloud write, paid LLM request, OAuth flow, credential read, Git commit, push, publication, video, or contest submission occurred.

## Shared SDK readiness increment (2026-10-22)

- Provider-backed diagnosis now selects `SharedDiagnosisProvider` by default. The old direct-fetch adapter is reachable only with `LIARA_DIAGNOSIS_ADAPTER=legacy`. The Shared adapter constructs `createProviderClient` from the installed, vendored `@starcoach/core-llm@0.5.0`; the SDK performs the bounded fetch to the fixed endpoint.
- The Shared adapter requires `LIARA_LLM_MAX_ATTEMPTS`, `LIARA_LLM_WINDOW_SECONDS`, and `LIARA_LLM_MAX_CONCURRENT`. Missing values produce a `MISSING_CONFIGURATION` status with `configuration: REQUEST_QUOTA_REQUIRED`; invalid values produce `LLM_CONFIGURATION_INVALID`. Both fail closed before transport. Direct construction of `SharedDiagnosisProvider` without `requestQuota` still throws.
- Results now carry `origin: PROVIDER`, `adapter`, and sanitized `provenance` (`sdk`, requested/returned model, HTTP status, latency, response bytes, attempts). Deterministic results carry `origin: DETERMINISTIC`, `adapter: offline`, and `provenance: null`. Failures return the deterministic diagnosis plus the fallback reason and sanitized HTTP metadata; no paid-provider switch or retry occurs.
- `/api/diagnose` now uses `RecoveryWorkflow.diagnosisEvidence()`. It rejects unconfirmed evidence with HTTP 409 and passes normalized `MODULE_NOT_FOUND`/`missing.mjs` signals for the selected failed release. Before this fix, the route passed UI log objects without those fields and deterministic diagnosis returned `insufficient_confirmed_evidence`.
- The UI badge starts as `REPLAY + MOCK`; it becomes `REPLAY + MOCK • آفلاین` for the offline provider, `REPLAY + MOCK + LLM` for a complete configuration, and an explicit unconfigured/owner-approval state otherwise. Diagnosis output shows adapter/SDK, requested and returned model, HTTP status, latency, and a distinct `تشخیص قطعی (fallback)` label.
- `npm test` exited **0**: **86 tests, 85 passed, 0 failed, 1 skipped** (`EPERM` symlink restriction). New fake-transport coverage includes Shared-by-default selection, quota fail-closed behavior, Shared 403 sanitization/provenance, normalized REPLAY diagnosis, fallback route labeling, and the acceptance harness gates. `npm run smoke` passed.
- `npm run llm:acceptance-preflight` exited **0** with `requestAttempts: 0`. It reported adapter `shared`, SDK `@starcoach/core-llm@0.5.0`, endpoint `https://ai.boxapi.ir/ai/v1/chat/completions`, requested model `openai/gpt-4.1-mini`, quota 1/60s/concurrency 1, 1,500 input-token upper bound, 300 output-token limit, maximum estimated cost `$0.001242`, and cap `$0.02`. `--execute` without gates exited **2** with `OWNER_ACCEPTANCE_APPROVAL_MISSING` and `requestAttempts: 0`.
- Browser checks used the offline server plus a second status-only server with a dummy key/configuration. The latter displayed the Shared adapter and configured model/quota/cost without sending an inference request; local resource timing showed only the page, font, and local API routes.
- Evidence labels: `SDK_CONNECTED` and `MOCK_TRANSPORT_TESTED`. `REAL_INFERENCE_NOT_TESTED`. No `REAL_INFERENCE_VALIDATED` result exists. In this validation run no provider credential was read and no provider request was sent; this does not describe the separate, earlier owner-run BoxAPI attempts (two HTTP 403 responses, see [BOXAPI_403_TROUBLESHOOTING.md](BOXAPI_403_TROUBLESHOOTING.md)).

## Engineering audit pass (2026-10-22, Node v24.16.0)

- Baseline before changes: `npm test` exited **0**, **86 tests, 85 passed, 0 failed, 1 skipped** (`EPERM` symlink restriction).
- After changes: `npm test` exited **0**, **89 tests, 88 passed, 0 failed, 1 skipped**. The three added tests are in `tests/hardening.test.mjs` (concurrent deployment, loopback/origin/content-type guard, blank budget variables fail closed). `npm run smoke` and `npm run llm:acceptance-preflight` exited 0; the preflight reported `credentialConfigured: false` and sent no request.
- All tests use injected fake transports; no LLM, Liara or other external request was made. Details and fixes: [AUDIT_2026-10-22.md](AUDIT_2026-10-22.md).
- The new curated package was built and verified from an isolated directory with `node scripts/verify-package-submission.mjs`; its output is reported in the audit hand-off, not duplicated here.

## Approval-state and LLM-safeguard hardening (2026-10-23, Node v24)

- Races reproduced with deterministic barriers in `tests/concurrency.test.mjs` before the fix (5 of 6 failed): `denyDeploy` accepted while `deploy()` awaited its package read, after which the provider write still ran; `inspect()` mutated observation/status during repair and deployment; `/api/reset` replaced and cleaned up a session with an active operation.
- Fix: `RecoveryWorkflow` refuses approve/deny/apply/deploy/inspect with `BUSY` while another operation is in flight, `deploy()` re-checks its approval immediately before the one-use claim, and `/api/reset` returns HTTP 409 `CONFLICT` instead of replacing a busy session. No cloud-write capability was added; approvals remain one-use and content-bound; no operation is retried.
- LLM safeguards (offline mock tests in `tests/llm-safeguards.test.mjs`): the cost gate now counts the system prompt; an injected `fetch` defaults to `transportMode: MOCK` (only the global `fetch` defaults to `LIVE_LLM`); the acceptance script's exit code now fails on a wrong diagnosis or missing real-attempt evidence via `evaluateAcceptance()`. These tests were added with the fix and were not run red first.
- `npm test` exited **0**: **100 tests, 99 passed, 0 failed, 1 skipped** (`EPERM` symlink restriction). `npm run smoke` and `npm run llm:acceptance-preflight` exited 0. There is no `npm run llm` script; the LLM-related tests (`diagnosis-providers`, `llm-acceptance`, `llm-safeguards`) passed 30 of 30. No provider, Liara or network request was made.

## Offline Coding Agent Handoff increment (2026-10-23)

- Added a strict structured REPLAY failure envelope and `proposeRepair(RepairRequest) -> RepairProposal` deterministic `FAKE_AGENT` adapter. Release and evidence correlation is checked before handoff; raw logs are not carried into the request. Oversized, control-character, prompt-injected, uncorrelated, and unsupported evidence is rejected.
- The proposal is bound to request/run/release/evidence identifiers and the exact source `baseDigest`. Only the exact `package.json` / `scripts.start` replacement (`node missing.mjs` → `node server.mjs`) is accepted. The existing two one-use approval decisions and temporary fixture boundary remain. A timeline in the Persian RTL UI labels `REPLAY`, `FAKE_AGENT`, `LOCAL_HTTP`, `MOCK`, and simulated approvals.
- Targeted command `node --test tests/coding-agent.test.mjs tests/recovery.test.mjs`: **21 passed, 0 failed, 0 skipped**.
- Full command `npm test`: **104 tests, 103 passed, 0 failed, 1 skipped**. The skip is the existing symlink escape test because this Windows host returns `EPERM` creating the symlink.
- `npm run smoke`: **passed**, offline `MOCK` digest and candidate check.
- Evidence remains synthetic `REPLAY`; adapter is deterministic `FAKE_AGENT`; health is isolated fixture `LOCAL_HTTP`; deployment and candidate states are in-memory `MOCK`. The full suite uses injected transports and local fixtures; no authenticated Liara call, cloud write, external inference, or dependency install was performed in this increment.
- Independent Kilo review: **REVIEW_NOT_RUN**. No separate paid-model authorization or configured cost cap was provided, and no CLI availability/authentication probe was made.
- `docs/CODING_AGENT_HANDOFF.md` records the end-to-end demo steps and scope limits. Live Liara access, a real coding-agent connection, authentic owner approval, durable actor-bound approval, and real Cloud deployment remain unverified/not implemented.
