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

server.listen(8765, '127.0.0.1', () => {
  console.log('Kaordo site: http://localhost:8765/');
});
