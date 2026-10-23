# Liara submission checklist

Status last reviewed: 2026-10-23 final targeted remediation. This is a local preparation checklist; it does not claim a GitHub publication or contest submission.

## Required deliverables

- [x] Executable MVP entrypoint: `npm run demo`. The local demo was exercised through the visible UI (diagnosis, rejection, approved repair, local health, separate deployment approval, and `MOCK` success) and over loopback HTTP.
- [x] Markdown architecture, API, limitation, and user interaction documentation: `README.md`, `docs/ARCHITECTURE.md`, `docs/START_HERE.md`, `docs/LIARA_READ_ONLY_PREFLIGHT.md`.
- [ ] Publish the reviewed repository and required docs on GitHub. No Git remote is configured; publication is not authorized in this task.
- [ ] Record and submit the approximately five-minute output-focused video. No recording tool was available to this task and no video file is present.
- [ ] Confirm current portal requirements, Liara team ID requirements, and deadline from the organizer before submission.

## Local source inventory

Required product source and test files include `src/`, `scripts/smoke.mjs`, `tests/`, and synthetic data in `fixtures/broken-node-app/`, `fixtures/recovery-evidence/`, `fixtures/recovery-node-app/`, and `fixtures/liara-api/`. Installation also requires `package.json`, `package-lock.json`, and `vendor/starcoach-core-llm-0.5.0.tgz`. The repository `.gitignore` is included so a fresh checkout excludes environment files, dependencies, caches, and historical package folders. The self-hosted UI assets are `assets/fonts/Vazirmatn-Variable.woff2` (SHA-256 `4e3fa217d38fdafc1fea4414ceb58ca5e662cf0ab5fa735a8c8c20e8b42cad92`), `assets/fonts/OFL.txt` (SHA-256 `17e355067c8284f47743a1ee3b1ef7ff684ff0601eda357f9353b10b3016ab31`), and `assets/fonts/README.md`. Product documentation includes the README, `docs/INSTALLATION.md`, architecture, start guide, preflight guide, challenge brief/transcript, validation evidence, recording package, and this checklist. The package also carries `scripts/boxapi-one-shot.mjs` and `.env.example`, because the acceptance tests and `npm run llm:acceptance-preflight` need them; shipping that guarded script does not authorize any inference (the gates are listed in GITHUB_PUBLICATION_MANIFEST.md in the full workspace). Keep `.liara-readonly.example.json`; do not include a populated `.liara-readonly.json` or environment credentials.

An unrelated historical Torob handoff remains at `docs/implementation/TOROB_SOURCE_OF_TRUTH_2026-10-21.md`. It is self-labeled historical Torob material, is not referenced by the Liara docs, and is misplaced for a Liara-only repository; it was reported, not moved or deleted, and is excluded from the curated bundle. Astra/Luna coordination notes and the old root `INSTALL.md` recovery note also remain for provenance and are excluded. No existing workspace files were removed.

Vazirmatn v33.003 variable WOFF2 and its OFL 1.1 license are now self-hosted under `assets/fonts/`. The demo serves the font from one exact local route as `font/woff2`; the browser loaded the face with no external font request, and `system-ui` remains the fallback.

## Verification evidence

- Node `v24.16.0`, npm `11.18.0`.
- `node --check src/demo-server.mjs` and `node --check src/recovery-ui.mjs` passed. `node --test tests/concurrency.test.mjs tests/recovery-ui.test.mjs` passed: 30 tests, 30 passed, 0 failed, 0 skipped.
- The port-contract test now uses a 1,000 ms bounded readiness budget; the regression passed 10/10 isolated executions. Focused safety tests passed 46/46. Latest `npm test` passed: **172 tests, 170 passed, 0 failed, 2 Windows `EPERM` skips**. The earlier intermittent 450 ms `PENDING` remains unexplained at the scheduling-event level; no listener cause is asserted.
- `npm run smoke` passed offline in `MOCK` mode. An isolated copy of the current candidate also passed `npm ci --offline --ignore-scripts`: on Windows with Node `v24.16.0` and npm `11.18.0`, `npm test` reported 172 tests, 170 passed, 0 failed, and 2 Windows `EPERM` skips; on Linux `node:24-slim` with networking disabled, the suite passed 172/172.
- The local browser exercised UNKNOWN → Reset → Inspect → approved local repair. The warning remained visible and deployment approval/execute controls stayed absent. A read-only LIVE-diagnosis attempt displayed its HTTP 409 unavailable-evidence message, used dynamic alert semantics, and left focus on its triggering button. Light, Dark, and System were selected. No screen-reader run or screenshot file is claimed.
- The current source allowlist contains 111 unique, sorted paths, including `.gitignore`. Current candidate: `submission-package-opsdocktor-github-20261023d/`. Its verified count and manifest hash are recorded in the final session report. Earlier package candidates remain preserved. The new candidate was installed offline and tested in an isolated copy, as above.
- Offline provider, Liara-adapter, mock-deployment, process-agent, and metadata tests ran as part of the full suite. No Liara request, authentication, cloud write, paid action, publication, or portal submission occurred.

The exact current run record is in the local `OPS_DOCKTOR_EVIDENCE_2026-10-23_FINAL_TARGETED_REMEDIATION.md` handoff, which is not part of the source package.

## Package audit

All package names below except the explicitly identified current candidate describe preserved historical outputs.

`submission-package-opsdocktor-github-20261023d/` is the current candidate. `submission-package-opsdocktor-port-contract-stabilization-20261023c/` and `submission-package-opsdocktor-final-remediation-20261023b/` remain preserved as predecessors.

- Preserved historical packages: `submission-package/` (41 files), `submission-package-llm/` (44), `submission-package-llm-final/` (44), `submission-package-ready/` (44), `submission-package-readonly-v2/` (45), and `submission-package-final-readonly/` (45). They predate or omit the pinned `@starcoach/core-llm` dependency, lockfile, and vendor tarball, so a clean checkout cannot resolve the current source imports. Do not publish them as the final release.
- `submission-package-offline-04ad8aea-fb1f-480b-9863-ff6a244a0653/` and `submission-package-offline-6f3c2587-1ac1-4530-b72d-6877049b091d/` (48 files each) include `package-lock.json` and the pinned vendor tarball. The `6f3c...` package is the newer verified predecessor and remains preserved.
- `submission-package-offline-final/` (48 files) was generated during this readiness pass but superseded by the final documentation correction; it is preserved and is not the recommended candidate.
- `submission-package-offline-release/` (48 files) was the verified pre-font candidate. It remains preserved but does not contain the self-hosted font or license, so it is superseded for final publication.
- `submission-package-offline-release-vazirmatn/` (51 files) was the font-bearing candidate before the Shared-SDK default and the 2026-10-22 audit. It is preserved and superseded.
- `submission-package-opsdocktor-20261022a/` (74 files) is superseded: its documentation index linked to files the package does not contain.
- `submission-package-opsdocktor-20261022b/` (74 files) passed isolated install, tests and smoke. It is preserved and superseded: it predates the final documentation corrections.
- `submission-package-opsdocktor-20261022c/` and `…d/` are superseded: each carried a documentation link or candidate pointer that the later correction fixed.
- `submission-package-opsdocktor-mission1-20261023/` was the verified Mission 1 candidate and remains preserved; at that historical checkpoint it was superseded by a hardening candidate. `submission-package-opsdocktor-hardening-20261023/` and `...hardening-20261023b/` are preserved hardening checkpoints; `b` includes the missing-billing regression but predates the final documented test totals. `submission-package-opsdocktor-20261023a/` and `submission-package-opsdocktor-20261022e/` predate Mission 1.

## Historical pre-release safety audit (not repeated during final targeted remediation)

- [x] Run `git status --short --branch` and review tracked modifications plus all untracked files.
- [x] Run a credential-pattern scan without printing matched values; no candidate matches were found in tracked or non-ignored untracked files.
- [x] Confirm `.liara-readonly.json` is absent; ignored credential paths and runtime/package output are excluded from the curated bundle.
- [x] Review the final tracked diff and curated file inventory.
- [x] Verify the curated package's relative Markdown links and rerun tests/smoke from inside the package.
- [x] Exclude historical Torob, Astra/Luna handoff, and recovery-note files from the curated bundle while preserving them in the workspace.
- [ ] Publish the exact GitHub manifest after the owner supplies/authorizes the destination.

## Live-read-only gate

Before any authenticated read, obtain separate account-owner approval naming the Liara team ID, project, release tag, maximum six-hour `since`/`until` range, purpose, and scoped credential source. Use the procedure in `docs/LIARA_READ_ONLY_PREFLIGHT.md`. Confirm the API contracts and account access on that authorized run; preserve sanitized evidence only. No write operation is enabled by this approval.
