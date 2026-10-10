// Serves the static applications with canonical directory routes

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';

const site = resolve(import.meta.dirname, '../dist/pages');

export function createPageServer(root = site) {
	const assets = sirv(root, { dev: true, etag: true });

	return createServer((request, response) => {
		response.setHeader('X-Content-Type-Options', 'nosniff');

		const url = new URL(request.url ?? '/', 'http://localhost');
		if (hasDirectoryIndex(root, url.pathname)) {
			response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
			return;
		}

		assets(request, response, () => {
			response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
			response.end('Not found');
		});
	});
}

function hasDirectoryIndex(root, pathname) {
	if (pathname === '/' || pathname.endsWith('/') || extname(pathname)) return false;

	let decodedPath;
	try {
		decodedPath = decodeURIComponent(pathname);
	} catch {
		return false;
	}

	const indexPath = resolve(root, `.${decodedPath}`, 'index.html');
	const relativePath = relative(root, indexPath);
	if (
		!relativePath ||
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return false;
	}
	return existsSync(indexPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const server = createPageServer();
	server.once('error', (error) => {
		console.error(
			error.code === 'EADDRINUSE'
				? 'Kaordo site cannot start: 127.0.0.1:8765 is already in use.'
				: `Kaordo site cannot start: ${error.message}`
		);
		process.exitCode = 1;
	});

	server.listen(8765, '127.0.0.1', () => {
		console.log('Kaordo site: http://localhost:8765/');
	});
}
