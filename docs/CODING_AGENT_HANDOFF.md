# OpsDocktor Coding Agent Handoff — Mission 2 local increment

## Current status

The current product path is offline-only and explicitly labeled `FAKE_AGENT`, `PROCESS_FAKE_AGENT`, or `TEST_DOUBLE`. These modes prove deterministic behavior, bounded process transport, and protocol validation; they do **not** prove authentic model inference. The authentic adapter is not configured or wired into the demo. Its constructor fails closed until separate owner authorization and an actual trusted, enforced sandbox runtime are available.

No provider/model invocation, credential access, Liara API request, Cloud Write, or deployment is part of the current evidence. Local repair approvals in the demo are simulated fixture decisions.

## RepairTask 2.0

`proposeRepair(RepairTask) -> RepairProposal` is bounded by an exact schema. The task binds:

- `requestId`, `runId`, `expectedGeneration`, `operationId`, and `selectedReleaseId`.
- `failureType`, sanitized evidence IDs and summaries, and `REPLAY`/`FAILED` provenance.
- A SHA-256 digest of the allowlisted source snapshot: only startup command, configured port, declared Liara port, and presence of named candidate entrypoints are included. Raw logs and arbitrary file contents are not forwarded.
- `allowedPaths: ["package.json"]`, `allowedOperations: ["REPLACE_JSON_FIELD"]`, one changed file, a 4-KiB patch bound, and a 5-second request timeout.

The proposal repeats the identity and source digest, cites task evidence IDs, and returns an issue-specific diagnosis, explanation, uncertainty, refusal status, and exact expected-old/replacement field contents. Host code supplies backend/model provenance; model output cannot assign itself a trusted label. Unknown fields, stale identities, fabricated evidence, unsupported paths/operations, excess output, and semantically unrelated changes are rejected.

## Offline issue cases

### Startup entrypoint missing

The selected failed release must identify the missing startup entrypoint. Static inspection confirms `scripts.start` points to it and the bounded snapshot identifies an available `.mjs` entrypoint. The supported repair changes only `package.json:scripts.start`. If no replacement entrypoint exists, the result is `NO_SAFE_REPAIR` with no changes.

### Explicit port-contract mismatch

The selected failed release must report an explicit `package.json config.port` / `liara.json port` mismatch, and static inspection must confirm the same integer values. The proposal changes only `package.json:config.port` to the declared Liara contract port. Values are derived from the task, so a different mismatch produces a different proposal. `EADDRINUSE` alone remains a manual advisory and never authorizes changing a port.

Both cases use separate synthetic app fixtures. The workflow independently validates proposal meaning, snapshots current metadata again before apply, requires one-use approval bound to the exact content and action, applies only to a fresh temporary trusted fixture, and re-inspects it. Startup verification reports generic fixture liveness. Port-contract verification reports static configuration agreement, generic liveness on the configured application port, and runtime response on the declared deployment port separately. An occupied requested port or ambiguous runtime produces `UNKNOWN`/`NOT_VERIFIED`; a generic HTTP 200 alone does not verify the port repair. The later `MOCK` deployment has a separate simulated approval.

## Adapter and sandbox boundary

`BoundedCodingAgentAdapter` defines the future host interface. Its invocation policy requires exact backend/executable identity, provider/model, authentication method, explicit network-host allowlist, invocation and estimated-cost caps, allowed data classes, repository scope, and an enforced read-only/cancellable sandbox with no tools, no writable paths, and no Liara or unrelated credentials. It passes a fixed argument list, structured JSON, byte limits, and a timeout. Each attempt consumes budget; timeout becomes `UNKNOWN` and is never automatically retried. Output is strictly parsed and semantically validated before host provenance is attached.

The trusted sandbox runtime itself is not implemented or supplied here. A child process is not a sandbox. The `PROCESS_FAKE_AGENT` worker remains a transport test and must not be substituted for OS isolation. No authentic backend is selectable from the demo. Kilo's official documentation currently states that its OS sandbox is unavailable on Windows; see [Kilo sandboxing](https://kilo.ai/docs/getting-started/settings/sandboxing). F1 remains blocked until a separate owner decision covers an approved backend, an enforcing sandbox runtime, explicit model/provider authorization, credential isolation, egress restrictions, call and cost limits, trusted provenance, data transfer, and the exact sandbox/test-repository scope.

### Invocation cost ledger

The adapter reserves its conservative preflight estimate before dispatch. A matching trusted transport result can report an actual charge separately from model JSON; that charge is finalized even when JSON parsing, semantic validation, or budget validation later rejects the proposal. Model-written cost fields are outside the proposal schema and are never billing evidence. A known charge above the estimate or configured budget is still recorded, and the invocation is rejected when it exceeds the authorized local budget.

Timeouts and results without trusted billing metadata retain the reservation and block later dispatches. Finalized charges and reservations exist only in process memory; restart loses both the ledger and unresolved-billing lock. This ledger is a local admission/accounting safeguard, not an externally enforced billing limit or proof of provider charges. The authentic adapter remains fail-closed and these paths are verified only with offline transport doubles.

## Reproduce the offline checks

From the repository root, using the already-installed local dependencies:

```powershell
npm test
npm run smoke
npm run demo:process
npm run demo:port-config-mismatch
```

In the UI, choose **فایل شروع ناموجود** to review the startup proposal, or choose **تفاوت پورت برنامه و قرارداد انتشار** to review the numeric port correction. Approve and apply only the local fixture patch; observe the separate `LOCAL_HTTP` result. `port-conflict` and `missing-config` remain advisory-only. All approvals are simulated. Deployment stays `MOCK` and is a separate action.

The test suite uses trusted synthetic fixtures, deterministic adapter doubles, and a known local Node child. It does not install dependencies, access credentials, or make provider/Liara requests. Symlink tests may skip on Windows when the host returns `EPERM`.

## Remaining limitations

- No authentic Coding Agent was invoked; no provider/model, authentication, outbound inference, usage, or real inference cost is verified.
- The OS sandbox runtime and authenticated backend wiring remain pending their separate authorization and host support.
- The offline fake's two issue-specific responses are demonstrations and do not count as authentic agent intelligence.
- Repair is limited to two trusted fixture cases and one JSON field in a temporary fixture. It is not a general repository editor.
- Simulated approvals are not actor-bound persistent owner approvals. No Liara authenticated read, Cloud Write, live deployment, or live release verification is implemented.
