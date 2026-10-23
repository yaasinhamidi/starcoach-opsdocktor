# Installation and reproduction

## Requirements

- Node.js 24 or later and npm.
- The only runtime dependency is the pinned `@starcoach/core-llm` 0.5.0 tarball in `vendor/`. Install it from the committed lockfile with no registry access:

```powershell
npm ci --offline --ignore-scripts
```

`src/diagnosis-providers.mjs` and `src/liara-readonly.mjs` import this package. A fresh checkout without `node_modules` cannot run the tests or demo until the command above succeeds. The tarball has no install scripts, and the command does not contact a registry or read credentials.

## Reproduce the checks

From the repository root in PowerShell:

```powershell
node --version
npm --version
npm ci --offline --ignore-scripts
npm test
npm run smoke
```

Tests and smoke checks use local synthetic fixtures and mock providers. They do not call Liara. The Port Contract tests use fixed local ports 3000 and 8080; stop any listener on those ports before running the full suite, because an occupied port can produce two environment-related failures instead of a false success.

To verify the local startup failure and corrected fixture independently of the replay demo:

```powershell
node scripts/verify-liara-test-app.mjs
```

## Run the offline UI

```powershell
npm run demo
```

Open <http://127.0.0.1:4173>. If port 4173 is already in use, select another port in a separate PowerShell window before starting:

```powershell
$env:PORT = '4174'
npm run demo
```

Then open <http://127.0.0.1:4174>. The default demo is `REPLAY + MOCK`; local fixture health is separately labeled `LOCAL_HTTP`. No credential is needed.

## Verify a curated package

The exact sorted file allowlist is `scripts/package-allowlist.json`. Packaging rejects missing/non-regular or symlink files, credential/private-file markers, unsafe relative links, and sibling application paths. `CONTENT_MANIFEST.json` records every package file's normalized path, exact byte size, and SHA-256; it does not hash itself. The verifier rejects missing, extra, or modified package files. From the repository root:

```powershell
npm run package:submission -- submission-package-<new-suffix>
npm run package:verify -- submission-package-<new-suffix>
cd submission-package-<new-suffix>
npm ci --offline --ignore-scripts
npm test
npm run smoke
```

Run this from a directory outside the repository if you want to prove the package does not resolve dependencies from the parent workspace.

## Optional owner-gated read-only preflight

Do not run it until the account owner approves the exact team, project, release, log window, GET scope, credential source, and quota/cost. Follow [LIARA_READ_ONLY_PREFLIGHT.md](LIARA_READ_ONLY_PREFLIGHT.md). Never put a token in a file tracked by Git, command-line text, chat, or logs.
