# OpsDocktor documentation map

One authoritative location per subject. **Current** documents describe the code in this checkout; **historical** documents are dated records kept for provenance and must not be read as current status.

The exact source package is controlled by [`scripts/package-allowlist.json`](../scripts/package-allowlist.json). Code-styled internal handoffs may be excluded; check that allowlist for the authoritative file set. `GITHUB_PUBLICATION_MANIFEST.md`, `docs/README.md`, the Mission 2 and Process Bridge reports, and the current demo instructions are included because their paths are allowlisted. The generated `CONTENT_MANIFEST.json` is added by the packager.

Evidence labels used throughout: `REPLAY` (fixture evidence), `LOCAL_HTTP` (real loopback check), `MOCK` (simulated deployment), `LIVE READ-ONLY` (owner-authorized GET evidence, never exercised yet), `UNKNOWN`/`UNAVAILABLE` (not established).

## Current

| Subject | Authoritative document |
| --- | --- |
| What it does, what works, what is simulated | [../README.md](../README.md) |
| Product mark, colors, and theme behavior | [OPSDOCKTOR_VISUAL_IDENTITY.md](OPSDOCKTOR_VISUAL_IDENTITY.md) |
| Install, run, test (offline) | [INSTALLATION.md](INSTALLATION.md) |
| Components, trust boundaries, approvals | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Diagnosis providers, Shared SDK, budgets | [LLM_DIAGNOSIS_PROVIDERS.md](LLM_DIAGNOSIS_PROVIDERS.md) |
| Provider configuration errors / HTTP 401, 403 | [PROVIDER_TROUBLESHOOTING.md](PROVIDER_TROUBLESHOOTING.md) |
| Liara read-only adapter and preflight | [LIARA_READ_ONLY_PREFLIGHT.md](LIARA_READ_ONLY_PREFLIGHT.md) |
| Demo script and recording | [DEMO_RECORDING_PACKAGE.md](DEMO_RECORDING_PACKAGE.md), [START_HERE.md](START_HERE.md) |
| First Liara test application | [FIRST_LIARA_TEST_APP_RUNBOOK.md](FIRST_LIARA_TEST_APP_RUNBOOK.md) |
| Submission steps and open items | [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md), [GITHUB_PUBLICATION_MANIFEST.md](GITHUB_PUBLICATION_MANIFEST.md) |
| Current GitHub-ready staging and release-gate results | [GITHUB_PUBLICATION_MANIFEST.md](GITHUB_PUBLICATION_MANIFEST.md), [../README.md](../README.md); detailed command record in `OPS_DOCKTOR_EVIDENCE_2026-10-23_FINAL_TARGETED_REMEDIATION.md` (local handoff; excluded from the source package to avoid self-hashing) |
| Historical 2026-10-22 validation record | [VALIDATION_2026-10-22.md](VALIDATION_2026-10-22.md) |
| Engineering audit and remaining risks | [AUDIT_2026-10-22.md](AUDIT_2026-10-22.md) |
| Challenge facts and open questions | [CONTEST_FACTS.md](CONTEST_FACTS.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md), [briefs/](briefs/) |
| Working agreement for agents | `AGENTS.md` |

## Historical (preserved, not current status)

| Document | Why kept |
| --- | --- |
| [BOXAPI_403_TROUBLESHOOTING.md](BOXAPI_403_TROUBLESHOOTING.md) | Record of two BoxAPI HTTP 403 responses; cause remains `UNKNOWN`. Do not rewrite. |
| `OPS_DOCKTOR_EVIDENCE_2026-10-23_MISSION1.md` | Historical local increment evidence; excluded from the source package. |
| `OPS_DOCKTOR_EVIDENCE_2026-10-23_THEME_BUTTONS.md`, `OPS_DOCKTOR_EVIDENCE_2026-10-23_UI_UX.md`, `OPS_DOCKTOR_EVIDENCE_2026-10-23_VISUAL_IDENTITY.md` | Superseded local release evidence; their candidate and test claims are historical. The final targeted-remediation handoff is the current test and candidate-gate record. |
| [OPS_DOCKTOR_EVIDENCE_2026-10-23_MISSION2.md](OPS_DOCKTOR_EVIDENCE_2026-10-23_MISSION2.md), [OPS_DOCKTOR_EVIDENCE_2026-10-23_PROCESS_BRIDGE.md](OPS_DOCKTOR_EVIDENCE_2026-10-23_PROCESS_BRIDGE.md) | Historical local increment evidence; included in the source package by the current allowlist, but superseded for current UI/UX and test status by the local handoff above. |
| `ASTRA_ARCHITECTURE_DECISION_2026-10-21.md`, `ASTRA_DECISION_REQUEST_2026-10-21.md` | Architecture decision input and request. |
| `LUNA_EXECUTION_HANDOFF_2026-10-21.md`, `REVIEW_HANDOFF.md` | Agent coordination notes. |
| `LIARA_STATUS_AND_STRATEGY_2026-10-21.md` | Pre-implementation analysis; its "not implemented" statements predate the recovery MVP. |
| `EXECUTION_PLAN.md`, `DECISIONS.md` | Early planning records. |
| `RESEARCH_SUMMARY.md`, `SOURCES.md`, `implementation/` | Secondary research and source provenance. |
| `INSTALL.md` | Note about restoring brief documents; not installation instructions. |

Archive candidates (not moved or deleted): the Astra/Luna files, `REVIEW_HANDOFF.md` and `implementation/`. They are excluded from the submission package.

## Naming

The product name is **OpsDocktor**. Identifiers that were not renamed on purpose, because they are contracts or evidence: package name `starcoach-liara-agent`, ledger/profile ids `opsdoctor`, `LIARA_*` environment variables, and quoted historical records.
