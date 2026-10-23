import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', version: 'liara-recovery-v1' }));
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

server.listen(Number(process.env.PORT ?? packageJson.config.port), '0.0.0.0');
