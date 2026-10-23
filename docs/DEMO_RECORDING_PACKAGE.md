# Five-minute demo recording package

This script shows the working output and keeps synthetic, local, and cloud evidence distinct. Target runtime: about 5:00. Rehearse with the incident and mock candidate selectors and start from a clean session. Use the separate-process demo (`npm run demo:process`). The header shows the inline OpsDocktor path mark with the separate **Starcoach OpsDocktor** product title and offers **خودکار / روشن / تاریک** (System / Light / Dark); first visit defaults to System and the selection persists locally. Liara remains the sponsor/challenge attribution in descriptive copy. Do not display source code, credentials, private logs, or account identifiers.

**Current release gate (2026-10-23): PASS.** The current candidate is `submission-package-opsdocktor-github-20261023d/` with 111 allowlisted paths, including `.gitignore`. An isolated offline install and validation passed on Windows with Node v24.16.0 and npm 11.18.0 (172 tests: 170 passed, 0 failed, 2 Windows `EPERM` skips) and on Linux `node:24-slim` with networking disabled (172/172). Ten isolated fixed-port regressions passed with the bounded 1,000 ms readiness budget; focused safety tests passed 46/46; offline `MOCK` smoke passed. The earlier intermittent 450 ms result remains unexplained at the scheduling-event level; there is no evidence tying it to a listener. The manifest hash is in the final session report; detailed command evidence is in the local handoff.

## Timed script and ordered interactions

| Time | Presenter narration | UI interaction and expected result |
|---|---|---|
| 0:00–0:30 | “This is OpsDocktor, a local recovery MVP for a failed Liara release. It passes a structured failure to a separate deterministic Node worker. The incident evidence is replay data, approvals are simulated, and deployment is a mock.” | Start the cross-process demo. Show the theme selector and briefly demonstrate Light, Dark, then System; show `PROCESS_FAKE_AGENT`, the worker PID, and the `REPLAY + MOCK` badge. The primary **بررسی انتشار** action is in the header. State that there is no authenticated Liara status and no live credential is used. |
| 0:30–1:15 | “The startup failure is reproducible. The failed release ran `node missing.mjs`; the older healthy release does not prove this release works.” | Optionally show `node scripts/verify-liara-test-app.mjs` reporting the intentional variant’s `MODULE_NOT_FOUND` exit before the UI. Click the header **بررسی انتشار** button and show `release-broken-7`, its matching `REPLAY` log, `node missing.mjs`, and prior healthy `release-stable-6`. The technical timeline is collapsed under **نمایش جزئیات فنی مراحل**. |
| 1:15–2:00 | “The evidence is correlated to the same failed release. A real child process returns a validated proposal bound to this request, release, evidence, and source digest. The repair is one exact start-command change.” | Point to the diagnosis title, `PROCESS_FAKE_AGENT` PID, request ID, confidence, `CONFIRMED` log attribution, and exact `package.json` diff from `node missing.mjs` to `node server.mjs`. |
| 2:00–2:45 | “I can refuse this repair. Refusal must change nothing. Then I’ll make a separate approval decision on a fresh copy.” | Click **رد اصلاح**; show `REPAIR_DECLINED` and that local health remains `NOT_RUN`. Click **شروع دوباره از نسخهٔ تمیز**, inspect again, then click **تأیید همین اصلاح**. Show `AWAITING_REPAIR` and explain the approval is exact, one-use, and separate from deployment. |
| 2:45–3:30 | “Applying the approved repair patches only the fresh local fixture copy, then runs a real loopback health check.” | Click **اعمال اصلاح تأییدشده**. Show `LOCAL_HTTP` and the exact checked endpoint rendered from the verification response. If the port-contract scenario is selected, distinguish static configuration agreement, generic fixture liveness, and runtime port-contract verification. State clearly that this verifies the local fixture, not Liara Cloud routing. |
| 3:30–4:20 | “Deployment requires a second, independent decision. The mock candidate must match its ID, version, ready state, and current state.” | Click **تأیید جداگانهٔ انتشار MOCK**, then **اجرای انتشار آزمایشی**. Show the Persian candidate identity, version `recovery-v2`, readiness, and جاری / غیرجاری state. Explicitly state that this is not a Liara deployment. |
| 4:20–5:00 | “The slice is deliberately bounded: synthetic replay, deterministic process transport, one exact local repair, and a simulated candidate. The process bridge is not a security sandbox or an LLM coding agent. This does not prove a live release, metrics access, or Liara account permission.” | Show the current test totals from `README.md` (Windows 172 tests: 170 passed, 0 failed, 2 `EPERM` skips; Linux 172/172) and the outcome screen. Summarize `REPLAY` → `PROCESS_FAKE_AGENT` → simulated repair approval → `LOCAL_HTTP` → separate `MOCK` approval → exact candidate verification. Do not present MOCK as a Liara deployment. End before 5:00 and do not show source code. |

Rehearse the reset and rejection path before recording; rejecting the repair requires a fresh reset before the approval path. If the five-minute cut overruns, use a separate longer backup recording rather than claim an unseen output. Never imply that a mock result ran live.

## Optional evidence branches (not required in the five-minute cut)

- **نامزد ناموفق:** reset with that scenario, inspect, approve/apply the repair, approve deployment, and deploy. The mock candidate reports `FAILED` even though the prior release is healthy.
- **نامزد آماده اما غیرجاری:** reset, repeat the same repair/deployment decisions, and show `FAILED` verification because the candidate is not current.
- **پاسخ مبهم پس از درخواست:** reset, repeat the repair/deployment decisions, and deploy. Show `UNKNOWN` and the no-retry explanation; a second deploy request is refused.
- **تعارض پورت / تنظیم مفقود:** choose `port-conflict` or `missing-config`, reset, and show the release-correlated `MANUAL_ACTION_REQUIRED` advice. These scenarios provide no patch or deployment action.

These branches repeat the repair and deployment approvals because reset creates a fresh workspace. Record them only if time allows; otherwise keep them as tested evidence and do not show an unobserved result.

## Expected labels and outputs

- `REPLAY`: synthetic release/log fixtures, not a live incident.
- `FAKE_AGENT`: in-process deterministic compatibility adapter.
- `PROCESS_FAKE_AGENT`: separate deterministic Node worker; process transport proof only, not model intelligence.
- `LOCAL_HTTP`: local `/healthz` check of the trusted fixture only.
- `MOCK`: simulated candidate state; never a Liara deployment.
- `UNKNOWN`: ambiguous outcome; no automatic retry.
- `LIVE READ-ONLY`: only if an owner later authorizes and runs the separate preflight. It is not enabled in the ordinary demo.

## Recording checklist

- [ ] Run `npm test` and `npm run smoke`; narrate the exact latest totals from `README.md`, including the 2 Windows `EPERM` skips and the unresolved 450 ms observation. Offline installation is already verified in an isolated copy; do not install dependencies during recording.
- [ ] Start one demo server with `npm run demo:process`; reuse it if already listening at `127.0.0.1:4173`. Do not start a second server on the same port.
- [ ] Open the page and rehearse reset, inspect, repair denial, approved repair, local health, deployment denial, mock success, and the unknown branch.
- [ ] Record a 1920×1080 or 1280×720 screen with readable browser text; use Persian narration or concise English narration over the Persian interface.
- [ ] Keep the browser URL local and frame the page so the evidence badge and result stay visible.
- [ ] Do not show `.liara-readonly.json`, environment settings, tokens, private logs, or account/team identifiers.
- [ ] Check duration is about 5:00, audio is understandable, and the output—not source code—is the focus.
- [ ] Save the final MP4/WebM outside this repository until its destination is known; inspect the final clip and confirm it plays.
- [ ] Submit the video using the organizer’s current portal and verify the portal confirms receipt.

## Exact operator procedure

1. If the page is not already reachable, run `npm run demo:process` from the repository and leave that terminal visible only if it contains no unrelated/private output. The server binds to `127.0.0.1:4173` by default; choose another local port only if 4173 is occupied.
2. Open `http://127.0.0.1:4173/` in the local browser. Confirm the theme selector offers **خودکار**, **روشن**, and **تاریک**; pick the preferred appearance. The UI defaults to System on first visit and remembers the selected preference locally.
3. Start the screen recorder available on the operator’s machine (for example OBS or Snipping Tool if installed), select the browser window or screen, enable the microphone, and verify the preview contains only the local demo page.
4. Start recording, follow the timed table, narrate the `REPLAY`, `LOCAL_HTTP`, and `MOCK` boundaries, and stop at 5:00.
5. Save the draft as `liara-demo-2026-10-23.mp4` in the destination selected by the owner, outside this repository. Play the saved file from beginning to end and verify duration, readable output, sound, and no secrets before portal upload.

No recording control was available to the assistant in this session, so no video file has been created or verified. The recording and final upload require the human operator.

## Fallback if live interaction fails during recording

Use the deterministic `npm test` result as supporting evidence and the screenshots only if they were captured by a permitted recording session. Rerun the local demo after fixing the local issue. If recording must proceed, narrate the intended step only when its result is visible; otherwise label it “not verified” and show the test output. Do not splice a test result into the UI or describe an unobserved result as a live interaction. A video is mandatory for submission; this fallback is not a substitute for recording.
