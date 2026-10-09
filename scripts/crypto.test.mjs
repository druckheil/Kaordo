// Verifies key identity binding, recovery validation and bounded attachment downloads
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAccountKeys,
	createDeviceKeys,
	destroyAccountKeys,
	sodium,
	toBase64,
	unwrapAccountKeys,
	wrapAccountKeys
} from '../packages/crypto/src/keys.ts';
import {
	createRecovery,
	parseRecoveryFile,
	restoreRecovery
} from '../packages/crypto/src/recovery.ts';
import { readResponseBytes } from '../packages/crypto/src/bytes.ts';
import { createDecryptedMediaCache } from '../packages/crypto/src/media-cache.ts';
import { installEncryptionSession } from '../packages/crypto/src/session.ts';
import {
	decryptMedia,
	encryptMedia,
	clearMediaSecrets,
	hasMediaKey
} from '../packages/crypto/src/media.ts';
import { createContentCodec } from '../packages/api-client/src/content-codec.ts';

const ownerId = '01999abc-1234-7000-8000-000000000001';

async function mediaSession(t) {
	const lifetime = new AbortController();
	const release = installEncryptionSession(ownerId, await createAccountKeys(), lifetime.signal);
	t.after(release);
	return { lifetime, cache: createDecryptedMediaCache(lifetime.signal) };
}

test('media consumers share bytes until the last view leaves and reopen after release', async (t) => {
	const { cache } = await mediaSession(t);
	const first = new AbortController();
	const second = new AbortController();
	let calls = 0;
	const load = async () => {
		calls++;
		return new Blob(['shared media']);
	};
	const [one, two] = await Promise.all([
		cache.open('media', load, first.signal),
		cache.open('media', load, second.signal)
	]);
	assert.equal(one, two);
	assert.equal(calls, 1);
	first.abort();
	assert.equal(await (await fetch(two)).text(), 'shared media');
	second.abort();
	await assert.rejects(fetch(two));
	const next = new AbortController();
	const reopened = await cache.open('media', load, next.signal);
	assert.notEqual(reopened, one);
	assert.equal(calls, 2);
	next.abort();
	await assert.rejects(fetch(reopened));
});

test('one cancelled reader preserves the shared download for another reader', async (t) => {
	const { cache } = await mediaSession(t);
	const first = new AbortController();
	const second = new AbortController();
	const data = Promise.withResolvers();
	let request;
	const load = (signal) => {
		request = signal;
		return data.promise;
	};
	const cancelled = cache.open('media', load, first.signal);
	const cancelledResult = assert.rejects(cancelled, { name: 'AbortError' });
	const retained = cache.open('media', load, second.signal);
	await Promise.resolve();
	first.abort();
	await cancelledResult;
	assert.equal(request.aborted, false);
	data.resolve(new Blob(['retained']));
	const url = await retained;
	assert.equal(await (await fetch(url)).text(), 'retained');
	second.abort();
	assert.equal(request.aborted, true);
});

test('abandoned media loads never retain a URL even if the loader ignores cancellation', async (t) => {
	const { cache } = await mediaSession(t);
	const reader = new AbortController();
	const data = Promise.withResolvers();
	const create = t.mock.method(URL, 'createObjectURL');
	const result = cache.open('media', () => data.promise, reader.signal);
	const rejected = assert.rejects(result, { name: 'AbortError' });
	await Promise.resolve();
	reader.abort();
	await rejected;
	data.resolve(new Blob(['late']));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(create.mock.callCount(), 0);
});

test('failed media loads can retry and ending the owner lifetime revokes active URLs', async (t) => {
	const { lifetime, cache } = await mediaSession(t);
	const reader = new AbortController();
	await assert.rejects(
		cache.open(
			'media',
			async () => {
				throw new Error('Unavailable');
			},
			reader.signal
		),
		/Unavailable/
	);
	const url = await cache.open('media', async () => new Blob(['retried']), reader.signal);
	assert.equal(await (await fetch(url)).text(), 'retried');
	lifetime.abort();
	await assert.rejects(fetch(url));
	assert.throws(() => cache.open('media', async () => new Blob([]), reader.signal), {
		name: 'AbortError'
	});
	reader.abort();
});

test('encrypted media opens only on demand and releases the decrypted file with its reader', async (t) => {
	await mediaSession(t);
	t.after(clearMediaSecrets);
	const file = new File(['private attachment'], 'private.txt', { type: 'text/plain' });
	const encrypted = await encryptMedia(file, { width: 0, height: 0 });
	const item = { ...encrypted.descriptor, id: '01999abc-1234-7000-8000-000000000002' };
	const source = URL.createObjectURL(encrypted.file);
	t.after(() => URL.revokeObjectURL(source));
	const reader = new AbortController();
	const url = await decryptMedia(item, source, reader.signal);
	assert.equal(await (await fetch(url)).text(), 'private attachment');
	reader.abort();
	await assert.rejects(fetch(url));
});

test('deferred attachments cannot migrate into a later account session', async (t) => {
	const { lifetime } = await mediaSession(t);
	t.after(clearMediaSecrets);
	const encrypted = await encryptMedia(new File(['private'], 'private.txt'), {
		width: 0,
		height: 0
	});
	const item = { ...encrypted.descriptor, id: '01999abc-1234-7000-8000-000000000003' };
	const codec = createContentCodec('https://api.example.test');
	const [attachment] = codec.media(
		[{ id: item.id, url: 'https://media.example.test/private' }],
		[item]
	);
	lifetime.abort();
	t.after(
		installEncryptionSession(
			'01999abc-1234-7000-8000-000000000002',
			await createAccountKeys(),
			new AbortController().signal
		)
	);
	const network = t.mock.method(globalThis, 'fetch', async () => {
		throw new Error('A previous account reached the network.');
	});
	await assert.rejects(attachment.loadURL(new AbortController().signal), { name: 'AbortError' });
	assert.throws(
		() => codec.media([{ id: item.id, url: 'https://media.example.test/private' }], [item]),
		{
			name: 'AbortError'
		}
	);
	assert.equal(network.mock.callCount(), 0);
	assert.equal(hasMediaKey(item.id), false);
});

function assertKeysEqual(actual, expected) {
	assert.deepEqual(actual.root, expected.root);
	for (const purpose of ['encryption', 'signing']) {
		assert.deepEqual(actual[purpose].publicKey, expected[purpose].publicKey);
		assert.deepEqual(actual[purpose].privateKey, expected[purpose].privateKey);
	}
}

test('sealed account keys restore only for the intended device and account identity', async () => {
	const keys = await createAccountKeys();
	const device = await createDeviceKeys();
	const otherDevice = await createDeviceKeys();
	const encryptionPublicKey = toBase64(keys.encryption.publicKey);
	const signingPublicKey = toBase64(keys.signing.publicKey);
	try {
		const sealed = await wrapAccountKeys(keys, toBase64(device.publicKey), ownerId);
		const restored = await unwrapAccountKeys(
			sealed,
			device,
			ownerId,
			encryptionPublicKey,
			signingPublicKey
		);
		try {
			assertKeysEqual(restored, keys);
		} finally {
			destroyAccountKeys(restored);
		}
		for (const [recipient, owner, encryption, signing] of [
			[otherDevice, ownerId, encryptionPublicKey, signingPublicKey],
			[device, 'another-account', encryptionPublicKey, signingPublicKey],
			[device, ownerId, toBase64(otherDevice.publicKey), signingPublicKey],
			[device, ownerId, encryptionPublicKey, toBase64(otherDevice.publicKey)]
		]) {
			await assert.rejects(unwrapAccountKeys(sealed, recipient, owner, encryption, signing));
		}
	} finally {
		destroyAccountKeys(keys);
		device.privateKey.fill(0);
		otherDevice.privateKey.fill(0);
	}
});

test('opened bundles reject malformed fields and private keys from a different key pair', async () => {
	const library = await sodium();
	const keys = await createAccountKeys();
	const otherKeys = await createAccountKeys();
	const device = await createDeviceKeys();
	const bundle = {
		version: 1,
		ownerId,
		root: toBase64(keys.root),
		encryptionPublicKey: toBase64(keys.encryption.publicKey),
		encryptionPrivateKey: toBase64(keys.encryption.privateKey),
		signingPublicKey: toBase64(keys.signing.publicKey),
		signingPrivateKey: toBase64(keys.signing.privateKey)
	};
	try {
		for (const value of [
			null,
			[],
			{ ...bundle, version: 2 },
			{ ...bundle, ownerId: 42 },
			{ ...bundle, root: undefined },
			{ ...bundle, root: toBase64(new Uint8Array(31)) },
			{ ...bundle, encryptionPrivateKey: 'invalid' },
			{ ...bundle, signingPrivateKey: toBase64(new Uint8Array(32)) },
			{ ...bundle, encryptionPrivateKey: toBase64(otherKeys.encryption.privateKey) },
			{ ...bundle, signingPrivateKey: toBase64(otherKeys.signing.privateKey) }
		]) {
			const encoded = new TextEncoder().encode(JSON.stringify(value));
			try {
				const sealed = toBase64(library.crypto_box_seal(encoded, device.publicKey));
				await assert.rejects(
					unwrapAccountKeys(
						sealed,
						device,
						ownerId,
						bundle.encryptionPublicKey,
						bundle.signingPublicKey
					),
					/Invalid account key bundle|account key is damaged/
				);
			} finally {
				encoded.fill(0);
			}
		}
	} finally {
		destroyAccountKeys(keys);
		destroyAccountKeys(otherKeys);
		device.privateKey.fill(0);
	}
});

test('recovery files restore account keys and reject damaged or foreign identities', async () => {
	const keys = await createAccountKeys();
	try {
		const { file, update } = await createRecovery(keys, ownerId);
		const parse = (value) =>
			parseRecoveryFile(
				JSON.stringify(value),
				ownerId,
				file.encryptionPublicKey,
				file.signingPublicKey
			);
		assert.equal(parse(file), file.secret);
		const restored = await restoreRecovery(
			file.secret,
			update.wrappedKeys,
			ownerId,
			file.encryptionPublicKey,
			file.signingPublicKey
		);
		try {
			assertKeysEqual(restored, keys);
		} finally {
			destroyAccountKeys(restored);
		}
		for (const value of [
			null,
			[],
			{ ...file, format: 'other' },
			{ ...file, version: 2 },
			{ ...file, secret: 'invalid' },
			{ ...file, secret: toBase64(new Uint8Array(31)) },
			{ ...file, secret: toBase64(new Uint8Array(32)).slice(0, -2) + 'B=' },
			{ ...file, ownerId: 'another-account' },
			{ ...file, encryptionPublicKey: toBase64(new Uint8Array(32)) },
			{ ...file, signingPublicKey: toBase64(new Uint8Array(32)) }
		]) {
			assert.throws(() => parse(value), /recovery file/);
		}
		assert.throws(() => parseRecoveryFile('{', ownerId, '', ''), /valid Kaordo recovery file/);
		assert.throws(() => parseRecoveryFile(' '.repeat(2049), ownerId, '', ''), /recovery file/);
	} finally {
		destroyAccountKeys(keys);
	}
});

test('attachment downloads assemble exact bytes and reject missing or invalid sizes', async () => {
	const response = new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
				controller.enqueue(new Uint8Array([3]));
				controller.close();
			}
		})
	);
	assert.deepEqual(await readResponseBytes(response, 3), new Uint8Array([1, 2, 3]));
	assert.equal(response.body.locked, false);
	for (const size of [0, -1, 1.5, NaN, Infinity, 100 * 1024 * 1024 + 37]) {
		await assert.rejects(readResponseBytes(new Response('a'), size), /Invalid attachment size/);
	}
	await assert.rejects(readResponseBytes(new Response(null), 1), /has no content/);
	await assert.rejects(readResponseBytes(new Response('a'), 2), /incomplete/);
});

test('oversized streams are cancelled before buffering beyond the declared bound', async () => {
	for (const declaredSize of [null, '4']) {
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2, 3, 4]));
				},
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: declaredSize ? { 'content-length': declaredSize } : {} }
		);
		await assert.rejects(readResponseBytes(response, 3), /exceeds its expected size/);
		assert.equal(cancelled, true);
		assert.equal(response.body.locked, false);
	}
});

test('failed stream cancellation preserves the original download error', async () => {
	const response = new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(2));
			},
			cancel() {
				throw new Error('Cancellation failed.');
			}
		})
	);
	await assert.rejects(readResponseBytes(response, 1), /exceeds its expected size/);
	assert.equal(response.body.locked, false);
});
