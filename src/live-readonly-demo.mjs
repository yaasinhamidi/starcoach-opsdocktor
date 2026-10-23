import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from './demo-server.mjs';
import { loadAuthorizedReadOnlyConfig } from './liara-readonly-preflight.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = await loadAuthorizedReadOnlyConfig({ repoRoot });
if (config.status !== 'READY') {
  process.stdout.write(`${JSON.stringify({ mode: 'UNAVAILABLE', status: 'UNAVAILABLE', reason: config.reason })}\n`);
  process.exitCode = 2;
} else {
  const { server } = await createDemoServer({
    liveReadOnlyAuthorized: true,
    readOnlyAdapter: config.adapter,
    liveProjectName: config.projectName,
    liveReleaseTag: config.releaseTag,
    liveSince: config.since,
    liveUntil: config.until,
  });
  const port = Number(process.env.PORT ?? 4173);
  server.listen(port, '127.0.0.1', () => console.log(`LIVE READ-ONLY evidence UI ready at http://127.0.0.1:${port}; no write operations are available.`));
}
