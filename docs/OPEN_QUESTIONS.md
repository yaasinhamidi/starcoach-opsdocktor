# Liara — remaining owner and submission questions

Updated 2026-10-22. Local MVP implementation and test scope are selected; only external owner decisions and submission tasks remain.

1. **Video:** Who will operate the screen recorder and submit the mandatory approximately five-minute video? No video file exists in this workspace.
2. **GitHub:** Which repository/destination is authorized for publication? No Git remote is configured, and this task does not authorize publication.
3. **Contest portal:** Are there newer written submission requirements, video limits, form requirements, Liara Team ID requirements, or deadline changes? The previously reported deadline was 2026-10-23 23:59 Tehran time and is not independently rechecked.
4. **Optional GET-only preflight:** Does the account owner approve the named team, project, release tag, bounded log window, GET endpoints, scoped credential, and any API quota/cost? Actual account access and the CLI-compatible v2 release-log contract remain unverified.
5. **Future LIVE writes:** No write workflow is implemented. Any future deploy or service-changing action needs separate owner authorization, verified API/rules, artifact-to-release identity, and persistent content-bound approval before implementation.

## Resolved for this MVP

- The chosen slice is offline recovery of one supported Node startup-entrypoint failure.
- The demo uses a Persian web UI and local Node fixtures. It requires Node.js 24+ and one install step for the pinned vendored `@starcoach/core-llm` 0.5.0 package: `npm ci --offline --ignore-scripts`. No registry or sibling workspace access is required.
- The regular demo is `REPLAY + MOCK`; only the fixture health check is `LOCAL_HTTP`.
- The in-app browser accessed the local demo and the diagnosis, rejection, repair approval, local-health, separate deployment approval, and mock-success controls were exercised. Screenshot capture was unavailable because the browser surface was hidden; no screenshot is claimed.
- The Persian UI self-hosts Vazirmatn v33.003 Variable WOFF2 with its OFL 1.1 license under `assets/fonts/`. The browser loaded the face, made no external font request, and retains a `system-ui` fallback.

Historical pre-brief questions about whether the challenge rubric existed and whether an AI agent/MCP/UI was allowed are superseded by the participant-supplied brief and transcript. Reopen them only if the organizer supplies new conflicting material.
