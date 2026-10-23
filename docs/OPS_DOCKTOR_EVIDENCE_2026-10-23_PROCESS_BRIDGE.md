# OpsDocktor offline release evidence — 2026-10-23

## Verdict

**ACCEPT — offline release scope only.** The process-backed recovery path, critical stale-state safeguards, advisory-only incident diagnoses, and offline evidence are implemented and verified below. This verdict does not assert that an authentic Coding Agent, LLM inference, Liara account read, or cloud deployment works.

## Environment and commands

Observed environment: Windows PowerShell, Node.js `v24.16.0`, npm `11.18.0`. Dependencies were already present; no install or network access was used for these checks.

| Command | Exit | Result |
|---|---:|---|
| `node --test tests/process-coding-agent.test.mjs tests/replay-diagnostics.test.mjs tests/recovery.test.mjs` | 0 | 35 passed, 0 failed, 0 skipped |
| `npm test` | 0 | 122 total, 121 passed, 0 failed, 1 skipped |
| `npm run smoke` | 0 | Offline approval-digest and MOCK candidate verification passed |

The one full-suite skip is the pre-existing Windows symlink escape test: the host denied symlink creation with `EPERM`. The focused process/recovery/advisory run had no skips. The smoke output explicitly says there is no live Liara integration.

## Process transport and workflow evidence

The positive transport test launches the fixed worker using the current Node executable. It asserts that the worker PID differs from the parent PID, that the worker reports the parent PID, that the executable is `process.execPath`, the script is the fixed `coding-agent-worker.mjs`, the working directory is fixed, and shell execution is disabled. The integration test asserts the workflow reports `PROCESS_FAKE_AGENT` and `SEPARATE_NODE_PROCESS`, then completes the local fixture repair and candidate-specific MOCK verification.

The end-to-end test verified these distinct stages:

1. Release-correlated synthetic `REPLAY` logs produce a bounded diagnosis.
2. A real Node child returns the validated one-file proposal.
3. A separate repair approval permits the exact trusted-fixture edit.
4. The repaired fixture returns a successful `LOCAL_HTTP` health result.
5. A separate deployment approval permits the simulated `MOCK` action.
6. The exact mock candidate is `candidate-1`, version `recovery-v2`, state `READY`, and current; verification returned success.

The worker receives a minimal allowlisted environment. The test confirms that `LIARA_READONLY_TOKEN`, `BOXAPI_API_KEY`, `OPENROUTER_API_KEY`, and the LLM authorization variable are absent. The parent bounds input and output, applies a timeout, kills a timed-out child, refuses overlapping requests, and rejects stderr, abnormal exit, duplicate or extra response lines, malformed packets, oversized output, and request/release/evidence/digest/path mismatches. The worker returns a single sanitized structured error for an invalid request.

Representative contract shape (per-run identifiers are intentionally omitted):

```json
{
  "request": {
    "version": "1.0",
    "requestId": "<per-run>",
    "runId": "<per-run>",
    "releaseId": "release-broken-7",
    "evidenceIds": ["<derived-from-fixture>"],
    "diagnosticCode": "STARTUP_ENTRYPOINT_MISSING",
    "baseDigest": "<sha256-of-current-fixture-content>",
    "allowedRepairScope": ["package.json:scripts.start"]
  },
  "proposal": {
    "releaseId": "release-broken-7",
    "fileChanges": [{
      "path": "package.json",
      "field": "scripts.start",
      "oldValue": "node missing.mjs",
      "replacementValue": "node server.mjs"
    }],
    "provenance": "PROCESS_FAKE_AGENT"
  }
}
```

The full implementation contract is in [CODING_AGENT_HANDOFF.md](CODING_AGENT_HANDOFF.md). Identifiers and digests above are explanatory placeholders, not captured runtime values.

## Critical negative evidence

- Invalid failure envelope, adapter error, malformed proposal, changed evidence after approval, and failed reinspection cannot preserve a stale actionable diagnosis or approval.
- The unsupported port-conflict and missing-configuration scenarios return human guidance only. Mixed, conflicting, injected, or uncorrelated logs remain ambiguous. They do not produce a repair proposal or deployment action.
- A healthy old release does not make a failed or non-current candidate successful.
- An ambiguous MOCK dispatch remains `UNKNOWN` and is not retried.
- Existing approval tests cover one-use, exact-content repair decisions and separately scoped deployment denial/approval.

## Workspace changes in this increment

Modified: `README.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/CODING_AGENT_HANDOFF.md`, `docs/DEMO_RECORDING_PACKAGE.md`, `docs/START_HERE.md`, `package.json`, `src/coding-agent.mjs`, `src/demo-server.mjs`, `src/recovery-ui.mjs`, `src/recovery.mjs`, `tests/recovery.test.mjs`.

Added: `src/process-coding-agent.mjs`, `src/coding-agent-worker.mjs`, `src/replay-diagnostics.mjs`, `tests/process-coding-agent.test.mjs`, `tests/replay-diagnostics.test.mjs`, `fixtures/recovery-evidence/port-conflict-logs.json`, `fixtures/recovery-evidence/port-conflict-releases.json`, `fixtures/recovery-evidence/missing-config-logs.json`, `fixtures/recovery-evidence/missing-config-releases.json`, `docs/OPS_DOCKTOR_EVIDENCE_2026-10-23_PROCESS_BRIDGE.md`, and `docs/NEXT_MORNING_HANDOFF_2026-10-24.md`.

The change inventory is based on work performed in this session; Git was not inspected because the objective prohibited Git operations. **Repository commit: not inspected.**

## Boundaries and remaining work

- Evidence inputs and deployment outcomes are synthetic; source-to-release identity is not established.
- `LOCAL_HTTP` verifies a fresh trusted local fixture. `MOCK` is an in-memory candidate simulation. Neither proves a Liara service or release.
- `PROCESS_FAKE_AGENT` is deterministic fixture logic in a separate process. It is not an LLM, a general coding agent, or a security sandbox.
- No live Liara request, cloud write, credential read, external inference, dependency installation, paid coding-agent CLI, Kilo review, browser interaction, video recording, or publication was performed.
- General framework analysis, arbitrary patching, durable actor-bound approval, live deployment, metrics integration, and continuous monitoring remain outside this release.
- The challenge video and submission/publication steps remain owner-operated. The five-minute script is in [DEMO_RECORDING_PACKAGE.md](DEMO_RECORDING_PACKAGE.md).
