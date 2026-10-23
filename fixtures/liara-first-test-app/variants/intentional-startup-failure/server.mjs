import { createServer } from 'node:http';

const artifactVersion = 'liara-first-test-failure-v1';
const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', artifactVersion }));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
