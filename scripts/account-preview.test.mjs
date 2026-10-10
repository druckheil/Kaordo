import assert from 'node:assert/strict';
import test from 'node:test';
import {
	accountPreviewKey,
	clearAccountPreview,
	readAccountPreview,
	rememberAccountPreview
} from '../packages/account-ui/src/session-preview.ts';

function memoryStorage() {
	const entries = new Map();
	return {
		getItem: (key) => entries.get(key) ?? null,
		setItem: (key, value) => entries.set(key, value),
		removeItem: (key) => entries.delete(key)
	};
}

const user = {
	id: '019977a2-5c18-75e4-ab57-6d5f4bb515c8',
	username: 'tester',
	displayName: 'Tester',
	createdAt: '2026-09-29T00:00:00Z',
	accessToken: 'must-not-be-cached'
};

test('the presentation cache stores only account metadata, never a bearer token', () => {
	const storage = memoryStorage();
	rememberAccountPreview(user, storage, 1_000);
	const raw = storage.getItem(accountPreviewKey);
	assert.ok(raw);
	assert.doesNotMatch(raw, /accessToken|must-not-be-cached|createdAt/);
	assert.deepEqual(readAccountPreview(storage, 1_001), {
		id: user.id,
		username: user.username,
		displayName: user.displayName
	});
});

test('stale or malformed metadata is ignored and removed', () => {
	const storage = memoryStorage();
	rememberAccountPreview(user, storage, 1_000);
	assert.equal(readAccountPreview(storage, 3_601_001), null);
	assert.equal(storage.getItem(accountPreviewKey), null);
	storage.setItem(
		accountPreviewKey,
		JSON.stringify({ id: user.id, username: user.username, savedAt: 1_000 })
	);
	assert.equal(readAccountPreview(storage, 1_001), null);
	assert.equal(storage.getItem(accountPreviewKey), null);
	storage.setItem(accountPreviewKey, '{not json');
	assert.equal(readAccountPreview(storage, 1_001), null);
	assert.equal(storage.getItem(accountPreviewKey), null);
});

test('sign-out clears the hint and unavailable storage does not break sign-in', () => {
	const storage = memoryStorage();
	rememberAccountPreview(user, storage, 1_000);
	clearAccountPreview(storage);
	assert.equal(readAccountPreview(storage, 1_001), null);
	const blocked = {
		getItem: () => {
			throw new Error('Storage disabled');
		},
		setItem: () => {
			throw new Error('Storage disabled');
		},
		removeItem: () => {
			throw new Error('Storage disabled');
		}
	};
	assert.doesNotThrow(() => rememberAccountPreview(user, blocked));
	assert.equal(readAccountPreview(blocked), null);
	assert.doesNotThrow(() => clearAccountPreview(blocked));
});
