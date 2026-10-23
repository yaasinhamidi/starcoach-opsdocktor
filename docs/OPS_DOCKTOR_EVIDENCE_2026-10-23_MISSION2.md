# OpsDocktor Mission 2 Evidence — 2026-10-23

## Verdict

**PARTIAL.** The offline vertical slice and regression suite are verified. No authentic Coding Agent was invoked, so Mission 2 does not meet its `ACCEPT` gate. The invocation remains pending separate owner authorization for the executable/backend, provider/model, authentication, outbound network, call and cost limits, data transfer, and sandbox/test-repository scope. No sandbox runtime with enforced filesystem and network isolation is available for this Windows host.

## Implemented and verified locally

- `RepairTask` 2.0 binds request, run, generation, operation, selected release, failure type, sanitized evidence IDs, source snapshot digest, allowlisted paths and operations, patch/file limits, timeout, and replay provenance.
- Strict `RepairProposal` validation checks identities, evidence references, provenance, exact fields and values, path/operation scope, patch size, and issue-specific meaning.
- The startup scenario derives the `scripts.start` correction from the named missing entrypoint and available `.mjs` entrypoint. Insufficient source evidence returns `NO_SAFE_REPAIR`.
- The separate port scenario derives `package.json:config.port` from a matching explicit `liara.json` contract. An `EADDRINUSE` signal alone stays advisory-only.
- Startup and port cases use distinct trusted fixtures. Workflow tests cover changed input values, stale source snapshots, one-use local fixture approval, exact patch application, and successful `LOCAL_HTTP` health verification.
- The bounded backend adapter seam enforces structured input/output, explicit policy fields, fixed host configuration, byte/time/call/cost bounds, semantic validation, and no automatic retry after timeout. Only the clearly labeled `TEST_DOUBLE` path is available; the authentic path fails closed.
- The existing process bridge remains labeled `PROCESS_FAKE_AGENT`; it proves child-process transport, not OS sandboxing or model inference. Simulated fixture repair approval and the separate `MOCK` deploy approval remain distinct.

## Verification evidence

Commands executed in the authorized app root:

| Command | Result |
|---|---|
| `node --test tests/bounded-coding-agent.test.mjs tests/coding-agent.test.mjs tests/process-coding-agent.test.mjs tests/replay-diagnostics.test.mjs tests/recovery.test.mjs` | Exit 0; 50 passed, 0 failed |
| `npm test` | Exit 0; 144 tests, 142 passed, 0 failed, 2 skipped |
| `npm run smoke` | Exit 0; offline MOCK approval digest and candidate verification passed |

The two full-suite skips are Windows symlink cases where the host returned `EPERM`. The first full-suite attempt exposed a mislabeled in-process test adapter; its test declaration was corrected to `FAKE_AGENT` while preserving the test's disconnected-client, active-operation, and Reset assertions. The final full-suite run passed.

The offline acceptance modes exercised were `FAKE_AGENT`, `PROCESS_FAKE_AGENT`, and `TEST_DOUBLE`; local fixture health was checked as `LOCAL_HTTP`; deployment smoke was `MOCK`. None of these establishes authentic inference or live Liara state.

## Backend, cost, and external interactions

- Authentic Coding Agent invocations: **0**.
- Provider/model, authentication, latency, token usage, and real inference cost: **not applicable / unverified**.
- Dependency installs, credential reads, environment changes, authenticated API requests, and Liara deployments: **none**.
- Kilo/Sol independent review: **REVIEW_NOT_RUN**; no separately authorized invocation or trusted Windows sandbox was available.
- Git status/HEAD was not inspected during this increment because Git operations are prohibited by the owner. The earlier Mission 1 Git-state entry in the publication manifest is a dated pre-increment snapshot.

## Changed-file inventory for this increment

- Sources: `src/bounded-coding-agent.mjs`, `src/coding-agent.mjs`, `src/coding-agent-worker.mjs`, `src/demo-server.mjs`, `src/local-health.mjs`, `src/process-coding-agent.mjs`, `src/recovery-ui.mjs`, `src/recovery.mjs`, `src/replay-diagnostics.mjs`.
- Tests: `tests/bounded-coding-agent.test.mjs`, `tests/coding-agent.test.mjs`, `tests/concurrency.test.mjs`, `tests/process-coding-agent.test.mjs`, `tests/recovery.test.mjs`.
- Synthetic fixtures: `fixtures/port-mismatch-node-app/liara.json`, `fixtures/port-mismatch-node-app/package.json`, `fixtures/port-mismatch-node-app/server.mjs`, `fixtures/recovery-evidence/port-config-mismatch-logs.json`, `fixtures/recovery-evidence/port-config-mismatch-releases.json`.
- Docs and package metadata: `README.md`, `docs/ARCHITECTURE.md`, `docs/CODING_AGENT_HANDOFF.md`, `docs/GITHUB_PUBLICATION_MANIFEST.md`, this report, `package.json`, `scripts/package-allowlist.json`.

The Mission 1 package directory was preserved. A separate Mission 2 package is generated from the exact source allowlist and verified locally. It has not been published or submitted.

## Deferred work and reproducible demo

Authentic backend wiring/invocation and its enforced OS sandbox remain deferred pending authorization and a suitable sandbox runtime. The adapter requires actual provider-specific transport integration before any later invocation. General-purpose source repair, persistent owner-bound approvals, live Liara reads/writes, cloud deployment, source-to-release identity binding, and continuous monitoring are outside this increment.

Run `npm test` and `npm run smoke` from the app root. To demonstrate the cases, run `npm run demo` and select the missing-startup scenario, or run `npm run demo:port-config-mismatch` for the explicit port-contract scenario. For the process transport proof, run `npm run demo:process`. Review the proposed diff, use only simulated fixture approval, and observe `LOCAL_HTTP`; any separate deployment step remains labeled `MOCK`.
