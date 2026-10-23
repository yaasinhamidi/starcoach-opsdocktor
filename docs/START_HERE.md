# Liara — start here (2026-10-23)

**Delivery state:** a runnable, offline Persian recovery product slice is present. It replays synthetic release/log evidence, automatically hands the bounded failure to either the compatibility `FAKE_AGENT` or the separate `PROCESS_FAKE_AGENT` Node worker, validates a single trusted-fixture proposal, requires separate simulated repair and deployment decisions, checks the repaired fixture over local HTTP, and verifies mock candidates. Port conflict and missing-configuration incidents produce manual guidance only. No authenticated Liara operation or cloud deployment has been performed.

## Run and test

Requirements: Node.js 24+ and npm. Install the pinned vendored dependency once with `npm ci --offline --ignore-scripts`; this resolves `@starcoach/core-llm` 0.5.0 from `vendor/` using the committed lockfile and needs no registry access.

```powershell
npm --version
node --version
npm ci --offline --ignore-scripts
npm test
npm run smoke
npm run demo
npm run demo:process
```

Optionally, `node scripts/verify-liara-test-app.mjs` reproduces the intentional startup failure locally and verifies the healthy and corrected variants over loopback HTTP.

Open <http://127.0.0.1:4173>. `npm run demo` selects the in-process compatibility adapter; `npm run demo:process` selects the separate Node worker and displays its PID. The demo uses `REPLAY` for incident evidence and `MOCK` for simulated deployment. Its header shows the inline OpsDocktor mark, **Starcoach OpsDocktor** wordmark, and three controls **خودکار / روشن / تاریک** (System / Light / Dark); the primary Inspect action appears before the collapsed technical timeline. The repaired fixture's `/healthz` is a real local HTTP check labelled `LOCAL_HTTP`; it does not verify a Liara service. Choose the synthetic incident selector for startup failure, port conflict, or missing configuration; press Reset to start that scenario.

## Current offline release gate (2026-10-23)

The current source candidate is `submission-package-opsdocktor-github-20261023d/` with 111 allowlisted paths, including `.gitignore`; candidate `submission-package-opsdocktor-port-contract-stabilization-20261023c/` and all earlier candidates remain preserved. An isolated offline install and validation of the new candidate passed on Windows with Node v24.16.0 and npm 11.18.0 (172 tests: 170 passed, 0 failed, 2 Windows `EPERM` skips) and on Linux `node:24-slim` with networking disabled (172/172). Ten isolated Port Contract executions passed with the bounded 1,000 ms readiness budget; relevant focused safety tests passed 46/46; `npm run smoke` passed offline in MOCK mode. The full suite needs fixed local ports 3000 and 8080 free. The earlier intermittent 450 ms result remains unexplained at the scheduling-event level; no listener cause is asserted. The manifest hash is recorded in the final session report; source packages exclude the local evidence handoffs to avoid self-hashing.

## Five-minute offline demo

1. **0:00–0:30:** run `npm run demo:process`; show the Persian UI, `PROCESS_FAKE_AGENT`, worker PID, and `REPLAY + MOCK` badge. State that the incident evidence and deployment are local simulations; LIVE access is disabled.
2. **0:30–1:15:** show the reproducible failure with `node scripts/verify-liara-test-app.mjs` (intentional variant exits 1 with `MODULE_NOT_FOUND`), then click the header “بررسی انتشار”. Show the matching failed-release log, `node missing.mjs`, and the older healthy release. State that the log is replay fixture data, not a current Liara incident.
3. **1:15–2:00:** explain the diagnosis, confidence, `CONFIRMED` release-log attribution, process request ID, and exact `package.json` change to `node server.mjs`. Point out that a healthy old release does not prove the failed release works.
4. **2:00–2:45:** click “رد اصلاح” and show that no repair or health check occurred. Reset from the clean copy, inspect again, and click “تأیید همین اصلاح” to record the independent repair decision.
5. **2:45–3:30:** click “اعمال اصلاح تأییدشده”. Show `LOCAL HTTP VERIFIED`, HTTP 200, and the matching `liara-recovery-v1` marker from the repaired local fixture.
6. **3:30–4:20:** click “تأیید جداگانهٔ انتشار MOCK”, then “اجرای انتشار آزمایشی”. Show the successful `MOCK` candidate identity, version `recovery-v2`, `READY` state, and current state. Explicitly state that this is not a Liara deployment.
7. **4:20–5:00:** state limitations: `REPLAY`/`MOCK` only, bounded startup-entrypoint and explicit port-contract diagnosis, no source-to-live-release proof, no cloud writes, and no authenticated Liara status. Show the exact test summary from `README.md` (Windows 172 tests: 170 passed, 0 failed, 2 `EPERM` skips; Linux 172/172), including the unresolved 450 ms observation; do not present a preserved older package as the current candidate. End on the outcome screen, not source code.

## Evidence boundaries and navigation

- `REPLAY`: fixture release and log evidence; not a live incident.
- `FAKE_AGENT`: in-process deterministic adapter; compatibility mode.
- `PROCESS_FAKE_AGENT`: separate deterministic Node worker; transport proof, not model intelligence.
- `LOCAL_HTTP`: a local health check against the trusted repaired fixture.
- `MOCK`: simulated deployment/candidate verification; not a Liara release.
- `LIVE READ-ONLY`: disabled unless the account owner separately authorizes and configures the documented bounded read-only preflight. No credentials are needed for the offline demo.
- `UNKNOWN`: an ambiguous outcome is not retried automatically.

Optional provider-backed diagnosis is documented in [LLM_DIAGNOSIS_PROVIDERS.md](LLM_DIAGNOSIS_PROVIDERS.md). The default remains deterministic/offline. Provider transport tests are mocked; a configured key/model is not evidence of `LIVE_LLM`. ChatGPT-plan OAuth is intentionally unavailable in this increment.

Read the supplied [challenge brief](briefs/STARCOACH_LIARA_BRIEF_2026-10-21.md) and [video transcript](briefs/STARCOACH_LIARA_VIDEO_TRANSCRIPT_2026-10-21.txt), [architecture](ARCHITECTURE.md), [five-minute recording package](DEMO_RECORDING_PACKAGE.md), [installation guide](INSTALLATION.md), and [submission checklist](SUBMISSION_CHECKLIST.md). The written brief is a participant-supplied reformatting, not an independently re-fetched organizer original. `npm run package:submission` creates a clean copy in the ignored `submission-package/` directory and refuses to overwrite it.

Do not deploy, contact merchants, enable authenticated reads, or infer successful cloud release from local tests or mock results.
