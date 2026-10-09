// Verifies clipboard file extraction across browser representations without duplicating attachments

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipboardFiles } from '../packages/media-client/src/clipboard.ts';

const image = new File(['image'], 'clipboard.png', { type: 'image/png' });
const video = new File(['video'], 'clipboard.webm', { type: 'video/webm' });
const item = (file) => ({ kind: 'file', getAsFile: () => file });

test('missing or text-only clipboard data contains no files', () => {
	assert.deepEqual(clipboardFiles(null), []);
	assert.deepEqual(
		clipboardFiles({ files: [], items: [{ kind: 'string', getAsFile: () => null }] }),
		[]
	);
});

test('the standard file list owns extraction without duplicating matching items', () => {
	assert.deepEqual(clipboardFiles({ files: [image, video], items: [item(image), item(video)] }), [
		image,
		video
	]);
});

test('file items remain available when the browser exposes an empty file list', () => {
	assert.deepEqual(clipboardFiles({ files: [], items: [item(image), item(video)] }), [
		image,
		video
	]);
});

test('unavailable items and string representations are ignored', () => {
	assert.deepEqual(
		clipboardFiles({
			files: [],
			items: [{ kind: 'string', getAsFile: () => image }, item(null), item(video)]
		}),
		[video]
	);
});
