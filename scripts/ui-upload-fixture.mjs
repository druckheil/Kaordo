// Receives synthetic tus upload bytes over HTTP across browser protocol backends

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export async function createUploadServer(allowedOrigin) {
	const uploads = new Map();
	let origin;
	const server = createServer((request, response) => {
		void handle(request, response).catch(() => {
			if (response.headersSent) response.destroy();
			else {
				response.writeHead(500);
				response.end('Synthetic upload failed');
			}
		});
	});

	async function handle(request, response) {
		response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
		response.setHeader('Access-Control-Allow-Credentials', 'true');
		response.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, HEAD, GET, OPTIONS');
		response.setHeader(
			'Access-Control-Allow-Headers',
			'Authorization, Content-Type, Tus-Resumable, Upload-Length, Upload-Offset, Upload-Metadata'
		);
		response.setHeader(
			'Access-Control-Expose-Headers',
			'Location, Tus-Resumable, Upload-Length, Upload-Offset'
		);
		response.setHeader('Tus-Resumable', '1.0.0');
		if (request.method === 'OPTIONS') {
			response.writeHead(204);
			response.end();
			return;
		}
		const path = new URL(request.url, origin).pathname;
		if (path === '/v1/uploads/' && request.method === 'POST') {
			const size = Number(request.headers['upload-length']);
			if (!Number.isSafeInteger(size) || size <= 0 || size > 1_000_000) {
				response.writeHead(400);
				response.end();
				return;
			}
			const id = randomUUID();
			uploads.set(id, { size, data: Buffer.alloc(0) });
			response.writeHead(201, { Location: origin + '/v1/uploads/' + id });
			response.end();
			return;
		}
		const id = path.split('/')[3];
		const upload = uploads.get(id);
		if (!upload) {
			response.writeHead(404);
			response.end();
			return;
		}
		if (request.method === 'PATCH') {
			if (Number(request.headers['upload-offset']) !== upload.data.length) {
				response.writeHead(409);
				response.end();
				return;
			}
			const chunks = [];
			let length = upload.data.length;
			for await (const chunk of request) {
				length += chunk.length;
				if (length > upload.size) throw new Error('Synthetic upload exceeds its declared size');
				chunks.push(chunk);
			}
			upload.data = Buffer.concat([upload.data, ...chunks]);
			response.writeHead(204, { 'Upload-Offset': String(upload.data.length) });
		} else if (request.method === 'HEAD') {
			response.writeHead(200, {
				'Upload-Offset': String(upload.data.length),
				'Upload-Length': String(upload.size)
			});
		} else if (request.method === 'GET' && path.endsWith('/meta')) {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					id,
					kind: 'file',
					mimeType: 'application/octet-stream',
					filename: id + '.bin',
					width: 0,
					height: 0,
					size: upload.size,
					complete: upload.data.length === upload.size
				})
			);
			return;
		} else if (request.method === 'GET' && path === '/v1/media/' + id) {
			response.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Content-Length': upload.data.length
			});
			response.end(upload.data);
			return;
		} else response.writeHead(405);
		response.end();
	}

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	origin = 'http://127.0.0.1:' + server.address().port;
	return {
		origin,
		uploads,
		stop: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}
