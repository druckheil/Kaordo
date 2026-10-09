// Checks production browser bundles for local service URLs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const pages = resolve(import.meta.dirname, '../dist/pages');
const localServiceUrls = [
	/http:\/\/localhost:8080/,
	/http:\/\/localhost:8081/,
	/http:\/\/127\.0\.0\.1:8082/
];
const publicOrigin = new URL(process.env.KAORDO_PUBLIC_ORIGIN || 'https://kaordo.link').origin;

async function javascriptFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await javascriptFiles(path)));
		else if (entry.name.endsWith('.js')) files.push(path);
	}
	return files;
}

test('production page bundles use the configured public service origin', async () => {
	const files = await javascriptFiles(pages);
	assert.ok(files.length > 0, 'production JavaScript bundles should exist');

	let hasPublicOrigin = false;
	for (const file of files) {
		const source = await readFile(file, 'utf8');
		for (const localServiceUrl of localServiceUrls) {
			assert.doesNotMatch(source, localServiceUrl, `${file} must not contain a local service URL`);
		}
		hasPublicOrigin ||= source.includes(publicOrigin);
	}

	assert.ok(hasPublicOrigin, 'production bundles should include the public service origin');
});
