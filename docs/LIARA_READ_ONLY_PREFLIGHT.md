# Liara read-only preflight

This procedure is an owner-authorization gate. It performs only GET requests and never enables deployment, restart, rollback, or other writes.

**Current account state:** the owner confirmed the team has 2,000,000 toman credit but has no applications or releases. Therefore no live read-only diagnosis is currently possible. Use the separate local workspace document `docs/FIRST_LIARA_TEST_APP_RUNBOOK.md` to prepare a dedicated Node app and create a release only after separate approval for each cloud write; that runbook and its synthetic test-app fixtures (`fixtures/liara-first-test-app`) are included in the curated offline package as preparation material only; shipping them performs no cloud action. Start with the healthy baseline, then use the intentional failure release as the diagnosis target; do not fill the preflight with placeholder IDs.

## Before running

1. The account owner separately authorizes read-only access to one named team and project, one release tag, and one recent log window.
2. Copy `.liara-readonly.example.json` to the ignored local file `.liara-readonly.json`. Set `ownerAuthorized` to `true` only after authorization, then enter the authorized `teamId`, `projectName`, `releaseTag`, and `since`/`until` timestamps. The range must be ordered and no longer than six hours.
3. Supply the scoped credential through the local `LIARA_READONLY_TOKEN` environment variable. Do not place it in this JSON file, source, chat, fixtures, or shell command text.
4. Set `LIARA_READONLY_OWNER_AUTHORIZED=YES` in the current local process only after the owner grants that scope.

## Owner selection and offline check

1. In the Liara dashboard, the owner selects an existing team, an existing test application, and an existing release. Prefer a failed Node.js release whose startup logs may contain a supported diagnosis signal. Do not create an application or release just to fill these fields.
2. Select a `since` and `until` time covering the relevant incident logs. Use ISO 8601 timestamps or Unix seconds; keep the interval ordered and at most six hours.
3. Copy `.liara-readonly.example.json` to `.liara-readonly.json` and fill in the selected `teamId`, `projectName`, `releaseTag`, `since`, and `until`. Keep `ownerAuthorized` false until the owner has approved that exact read scope.
4. Run this offline-only check:

   ```powershell
   node src/liara-readonly-preflight.mjs --check
   ```

   It validates the local file and time window, does not read environment credentials, does not construct an API adapter, and reports `apiRequests: 0`. It reports selector presence, not the selector values. A `CONFIG_VALID` result does not authorize access.
5. After separate approval, set `ownerAuthorized` to true in the local file and use the secure prompt below for the actual GET-only preflight.

## Run the preflight

```powershell
$secureToken = Read-Host 'Scoped Liara read-only token (hidden)' -AsSecureString
$tokenBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $env:LIARA_READONLY_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenBstr)
  $env:LIARA_READONLY_OWNER_AUTHORIZED = 'YES'
  npm run liara:readonly-preflight
} finally {
  Remove-Item Env:LIARA_READONLY_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:LIARA_READONLY_OWNER_AUTHORIZED -ErrorAction SilentlyContinue
  if ($tokenBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenBstr) }
  if ($null -ne $secureToken) { $secureToken.Dispose() }
}
```

Without both authorization gates and valid local configuration, the command reports `UNAVAILABLE` and returns without reading a token or making a request. When enabled, it requests project details, up to 100 releases, and selected-release logs. Each request is GET-only, uses an 8-second default timeout (maximum 60 seconds), and accepts at most 1 MiB of response JSON by default. Project identity must match the requested name; malformed release identities and duplicate release tags fail closed. Error bodies are discarded after extracting a constrained error code; raw response messages are not returned. The v2 CLI log contract has a start time but no documented end-time filter; `last_lines=true` is used, and entries outside the selected time range are removed locally. The six-hour limit bounds the evidence window, not a Liara server-side `until` parameter.

To present the same allowlisted evidence in the Persian UI, first complete the preflight, then run:

```powershell
npm run demo:live-readonly
```

The UI makes its GET-only requests when the read-only evidence control is selected. The ordinary `npm run demo` remains `REPLAY + MOCK` and never loads this configuration.

## Evidence labels

- `releaseLogAttribution`: whether non-empty log entries carried the exact selected release ID.
- `startupFailureIdentification`: whether a log explicitly names the supported `missing.mjs` startup entrypoint. Only the normalized basename and error category are retained; raw log text and arbitrary paths are discarded.
- `sourceToReleaseCorrespondence`: always `UNCONFIRMED` until independent evidence binds the local source snapshot or artifact digest to the selected Liara release.
- `UNAVAILABLE`: a required API read or local configuration is unavailable. `UNKNOWN`: a required read has an ambiguous result. Neither proves deployment failure.

No authenticated API access has been performed by this repository increment. Run this procedure only after the separate owner authorization above.
