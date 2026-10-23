# Liara first test application

Three isolated, dependency-free Node 22 variants live under `variants/`. Each variant has a `package.json` with an explicit `start`, a `liara.json` pinning Node 22 and port 3000, a `server.mjs`, and an `ARTIFACT_MANIFEST.json` containing SHA-256 file hashes and an artifact digest.

- `healthy-baseline`: `node server.mjs`, health marker `liara-first-test-healthy-v1`.
- `intentional-startup-failure`: `node missing.mjs` while `server.mjs` exists, health marker reserved as `liara-first-test-failure-v1`.
- `corrected-startup`: `node server.mjs`, health marker `liara-first-test-corrected-v1`.

Run the local verifier from repository root:

```powershell
node scripts/verify-liara-test-app.mjs
```

It verifies manifests, runs both healthy variants on loopback, and confirms the intentional failure is `MODULE_NOT_FOUND`. It performs no external requests. `--write-manifests` is intended only when deliberately changing these new fixture files.

Do not deploy any variant without separate owner approval. The startup-failure variant intentionally makes the dedicated test application unavailable while it is selected.
