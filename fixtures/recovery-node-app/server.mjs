import { createServer } from 'node:http';

const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', version: 'liara-recovery-v1' }));
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
