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

const ownerId = '01999abc-1234-7000-8000-000000000001';

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
