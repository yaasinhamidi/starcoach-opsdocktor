# GitHub publication manifest

## Current source-package gate (2026-10-23 GitHub-ready staging)

**Status: PASS; current source candidate is `submission-package-opsdocktor-github-20261023d/`.** The audited source allowlist has 111 unique, sorted paths: the previous 110-file layout plus the repository `.gitignore`. The new candidate was packaged with `npm run package:submission` and verified with `npm run package:verify`; its manifest digest is recorded in the final session report, outside the package, because `CONTENT_MANIFEST.json` hashes every packaged file. Candidate `submission-package-opsdocktor-port-contract-stabilization-20261023c/` and all earlier candidates are preserved as predecessors.

The package uses the exact-file allowlist and writes a sorted `CONTENT_MANIFEST.json` with sizes and SHA-256 hashes; it refuses to overwrite existing folders. Do not publish the surrounding workspace, `node_modules`, local runtime data, or any historical `submission-package-*` directory.

Validation in an isolated copy of the new candidate: offline `npm ci --offline --ignore-scripts` passed; `npm test` passed on Windows with Node v24.16.0 and npm 11.18.0 (172 tests: 170 passed, 0 failed, 2 Windows `EPERM` skips) and passed 172/172 on Linux `node:24-slim` with networking disabled; `npm run smoke` passed offline in `MOCK` mode; ten isolated fixed-port Port Contract executions passed with the 1,000 ms bounded readiness budget, and the relevant focused safety tests passed 46/46. The full suite requires fixed local ports 3000 and 8080 to be free. The earlier intermittent 450 ms `PENDING` remains unexplained at the scheduling-event level; no listener cause is asserted.

The source allowlist includes the pinned vendored `@starcoach/core-llm` 0.5.0 tarball, `package-lock.json`, self-hosted Vazirmatn font/license, OpsDocktor SVG assets, fixtures, tests, and product docs. It excludes `node_modules`, credentials, private logs, local runtime data, unrelated/historical internal handoffs, and the final local evidence handoff. The guarded one-shot BoxAPI preflight is included for offline tests; shipping it does not authorize external inference.

## Publication and submission blockers

- The required approximately five-minute recording does not exist; a human must record and verify it.
- GitHub publication and contest submission have not occurred. Confirm the destination repository, current portal, upload procedure, and deadline before submission.
- Public redistribution permission for the pinned vendored `@starcoach/core-llm@0.5.0` tarball is unverified: its package metadata marks it `private` and provides no license file or license field. The repository also has no project-level `LICENSE`. Obtain owner/legal clearance or replace the dependency before publishing.
- No authenticated Liara request or cloud write occurred. Account permission, release-log route compatibility, and source-to-release correspondence remain unverified.
- Two earlier owner-run BoxAPI requests returned HTTP 403 (cause UNKNOWN). No successful live inference is verified; OpenRouter and ChatGPT-plan/Codex have no live verification and OAuth is not implemented.

## Historical Git state snapshot (recorded before the Mission 2 increment; not refreshed here)

HEAD is still baseline `96239d4`; nothing is staged. Tracked files with local modifications: `.gitignore`, `AGENTS.md`, `README.md`, `package.json`, and five docs (`ARCHITECTURE`, `CONTEST_FACTS`, `EXECUTION_PLAN`, `OPEN_QUESTIONS`, `START_HERE`). **Most MVP product files are untracked**, including every recovery, demo, diagnosis-provider and Liara read-only file under `src/` (`recovery.mjs`, `demo-server.mjs`, `diagnosis-providers.mjs`, `liara-readonly*.mjs`, `live-readonly-demo.mjs`, `local-health.mjs`, `recovery-ui.mjs`), all new tests under `tests/`, the `scripts/` helpers, `vendor/`, `package-lock.json`, `assets/` and the new fixtures. Only `src/inspector.mjs` and `src/mock-provider.mjs` among the sources are tracked. The `submission-package*` folders and `node_modules/` are git-ignored. Publishing from the package folder contents avoids depending on tracking; publishing from the workspace root requires the owner to review and add the untracked files first.

No files have been staged, committed, pushed, published, or submitted.
