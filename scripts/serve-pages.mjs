import { createServer } from 'node:http';
import { resolve } from 'node:path';
import sirv from 'sirv';

const site = resolve(import.meta.dirname, '../dist/pages');
const assets = sirv(site, { dev: true, etag: true });

const server = createServer((request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  assets(request, response, () => {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
});

server.once('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? 'Kaordo site cannot start: 127.0.0.1:8765 is already in use.'
    : `Kaordo site cannot start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(8765, '127.0.0.1', () => {
  console.log('Kaordo site: http://localhost:8765/');
});
