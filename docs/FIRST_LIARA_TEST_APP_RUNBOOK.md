# First Liara test application runbook

**Preparation only:** this runbook does not create resources, log in, deploy, or spend the dashboard's 2,000,000 toman credit. The owner confirmed there are currently no apps or releases, so a read-only Liara diagnosis cannot happen until the first app and at least one release exist.

## Prepared local variants

Path root: `fixtures/liara-first-test-app/variants/`

| Variant | Start command | Expected result | Health marker | Artifact digest |
|---|---|---|---|---|
| `healthy-baseline` | `node server.mjs` | `/healthz` returns 200 | `liara-first-test-healthy-v1` | `4b40453c421fdc24920c0bc17b754bbff9ced22a5a68f14fb184fdb8d8a192a3` |
| `intentional-startup-failure` | `node missing.mjs` | exits with `MODULE_NOT_FOUND` | `liara-first-test-failure-v1` (server file is present but startup never reaches it) | `1547e37e610a75e67d2f959e69e704c4d905fada2fbac70ec4e398b24c12d4c8` |
| `corrected-startup` | `node server.mjs` | `/healthz` returns 200 | `liara-first-test-corrected-v1` | `950c94d06036538c10b2c31333658289a66938b31026ea913215a0fdc1bb525e` |

Each directory contains only a small `package.json`, `server.mjs`, `liara.json` (`port: 3000`, Node `22`), and `ARTIFACT_MANIFEST.json`. The digest binds the start command, version marker, and SHA-256 hashes of all three deployable files. Manifests are verified by `node scripts/verify-liara-test-app.mjs`; local results are not cloud evidence.

## Dashboard settings for the first app

The owner should create a dedicated app in Liara Console under the confirmed team. Liara's Node.js app-creation instructions call for choosing a unique app ID, network, and hardware/feature plan. Use:

- App ID: `liara-starcoach-probe-<unique-suffix>` (choose an available ID; do not reuse a production name).
- Platform: **NodeJS**.
- Network: the team's existing/default private network, if available; do not create a new network without separate approval.
- Hardware and feature plan: the smallest available suitable option, with the displayed price and billing interval reviewed before confirming.
- Runtime settings: Node.js 22, port 3000 (also pinned in each variant's `liara.json`).
- Add-ons: none—no database, disk, cache, domain, environment secret, or other service.

The available network/plans and their prices depend on the team's account and region. The 2,000,000 toman balance alone is not enough to estimate burn; record the Console's shown plan price and ask the owner before confirming app creation.

## Local validation before deployment

From the repository root, run:

```powershell
node scripts/verify-liara-test-app.mjs
```

Expected result: `mode: LOCAL_HTTP`, healthy baseline `HTTP 200`, failure variant `MODULE_NOT_FOUND`, and corrected variant `HTTP 200` with its distinct marker. No Liara calls are made. Run this again after any artifact edit; do not hand-edit a manifest. To intentionally regenerate manifests for changed source, use `node scripts/verify-liara-test-app.mjs --write-manifests` and review the changed digests.

## Owner-approved deployment sequence

First install/use the official Liara CLI and sign in interactively as the owner. Never put an API token in command-line arguments, source, or chat. Use the existing team ID and newly created app ID in the commands below. These are **cloud writes** and each requires separate approval:

1. **Create the app** in Console with the settings above. This provisions a billable resource.
2. **Deploy healthy baseline** only after explicit approval for this release:

   ```powershell
   liara deploy --team-id <TEAM_ID> --app <APP_ID> --platform node --port 3000 --path fixtures/liara-first-test-app/variants/healthy-baseline --message "liara-first-test-healthy-v1 sha256=4b40453c421fdc24920c0bc17b754bbff9ced22a5a68f14fb184fdb8d8a192a3"
   ```

   Wait for deployment to complete. Confirm `https://<APP_ID>.liara.run/healthz` returns HTTP 200 and JSON `{"status":"ok","artifactVersion":"liara-first-test-healthy-v1"}`.
3. Capture the healthy release ID and tag from that app's release/history screen. Save the displayed release state, deployment time, artifact digest, and a sanitized health response.
4. **Deploy the intentional startup failure** only after a separate approval. This variant will make the dedicated test app unavailable or leave its new candidate failed; never use it for a production/traffic-bearing app:

   ```powershell
   liara deploy --team-id <TEAM_ID> --app <APP_ID> --platform node --port 3000 --path fixtures/liara-first-test-app/variants/intentional-startup-failure --message "liara-first-test-failure-v1 sha256=1547e37e610a75e67d2f959e69e704c4d905fada2fbac70ec4e398b24c12d4c8"
   ```

   Capture its new release ID/tag and failure state from Console. The intended log signal is the missing `missing.mjs` entrypoint.
5. **Deploy the corrected startup** only after a third, separate approval:

   ```powershell
   liara deploy --team-id <TEAM_ID> --app <APP_ID> --platform node --port 3000 --path fixtures/liara-first-test-app/variants/corrected-startup --message "liara-first-test-corrected-v1 sha256=950c94d06036538c10b2c31333658289a66938b31026ea913215a0fdc1bb525e"
   ```

   Capture the corrected release ID/tag/state. Verify that this exact candidate is READY/current in Console, then issue an HTTP GET to the app's `/healthz` and require the exact corrected marker. A successful old baseline health response is not proof that the corrected release serves traffic.

Liara's current CLI documents `liara deploy` with `--app`, `--team-id`, `--platform`, `--port`, `--path`, and `--message`; its Node.js guide requires a `package.json` `start` script and supports `liara.json` Node/port settings. The runbook supplies the app/platform as CLI flags and keeps `liara.json` to Node version and port only.

## Release IDs and logs for diagnosis

For each release, record: app ID, release ID, release tag, state, creation time, the matching artifact marker/digest, and the selected log time window. In the Liara Console, open that app's deployment/release history and select logs for the exact failed release. The official CLI also supports release-scoped logs:

```powershell
liara app logs --team-id <TEAM_ID> --app <APP_ID> --release <RELEASE_TAG> --since "1 hour ago" --timestamps --last-lines
```

Keep the window under six hours. Do not send raw customer/private logs to an LLM. Once the owner separately approves the exact read-only scope and supplies a scoped local credential, put team ID, app ID, release tag, and the chosen `since`/`until` window in ignored `.liara-readonly.json`; run `node src/liara-readonly-preflight.mjs --check` first. Only then run the authenticated preflight. Release-log attribution is confirmed only when returned log metadata matches the selected release ID. Artifact digest in the Liara release message helps provenance, but `sourceToReleaseCorrespondence` remains `UNCONFIRMED` until independently checked.

The intentional outage, each deploy, app provisioning, any plan/resize/network change, and any deletion each require their own explicit owner approval. Do not infer that the dashboard credit authorizes spending.

## Official workflow references

- [Liara Node.js app creation](https://github.com/liara-cloud/docs/blob/master/src/pages/paas/nodejs/how-tos/create-app.mdx)
- [Liara Node.js deployment guide](https://github.com/liara-cloud/docs/blob/master/src/pages/paas/nodejs/how-tos/deploy-app.mdx)
- [Liara CLI deploy and release-filtered logs](https://github.com/liara-cloud/cli/blob/master/README.md)
