// Creates device-held account keys and authenticates encrypted key transfers with libsodium
import type Sodium from 'libsodium-wrappers';
import { accountKeyBundleSchema } from './validation.ts';

export interface KeyPair {
	publicKey: Uint8Array;
	privateKey: Uint8Array;
}
export interface AccountKeys {
	root: Uint8Array;
	encryption: KeyPair;
	signing: KeyPair;
}
let sodiumReady: Promise<typeof Sodium> | undefined;

export function sodium(): Promise<typeof Sodium> {
	return (sodiumReady ??= import('libsodium-wrappers').then(async ({ default: library }) => {
		await library.ready;
		return library;
	}));
}

export function toBase64(bytes: Uint8Array): string {
	let text = '';
	for (let i = 0; i < bytes.length; i += 8192)
		text += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return btoa(text);
}
export function fromBase64(value: string, size?: number): Uint8Array<ArrayBuffer> {
	if (typeof value !== 'string' || value.length > 3 * 1024 * 1024)
		throw new Error('Invalid encryption key or envelope.');
	const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
	if (toBase64(bytes) !== value) throw new Error('Invalid encryption key or envelope.');
	if (size !== undefined && bytes.length !== size)
		throw new Error('Invalid encryption key or envelope.');
	return bytes;
}

export async function createAccountKeys(): Promise<AccountKeys> {
	const library = await sodium();
	const box = library.crypto_box_keypair();
	const sign = library.crypto_sign_keypair();
	return { root: library.randombytes_buf(32), encryption: box, signing: sign };
}

export async function createDeviceKeys(): Promise<KeyPair> {
	return (await sodium()).crypto_box_keypair();
}

export async function wrapAccountKeys(
	keys: AccountKeys,
	devicePublicKey: string,
	ownerId: string
): Promise<string> {
	const library = await sodium();
	const encoded = new TextEncoder().encode(
		JSON.stringify({
			version: 1,
			ownerId,
			root: toBase64(keys.root),
			encryptionPublicKey: toBase64(keys.encryption.publicKey),
			encryptionPrivateKey: toBase64(keys.encryption.privateKey),
			signingPublicKey: toBase64(keys.signing.publicKey),
			signingPrivateKey: toBase64(keys.signing.privateKey)
		})
	);
	try {
		return toBase64(library.crypto_box_seal(encoded, fromBase64(devicePublicKey, 32)));
	} finally {
		library.memzero(encoded);
	}
}

export async function unwrapAccountKeys(
	sealed: string,
	device: KeyPair,
	ownerId: string,
	encryptionPublicKey: string,
	signingPublicKey: string
): Promise<AccountKeys> {
	const library = await sodium();
	if (sealed.length > 4096) throw new Error('Invalid account key bundle.');
	const decoded = library.crypto_box_seal_open(
		fromBase64(sealed),
		device.publicKey,
		device.privateKey
	);
	try {
		let value: unknown;
		try {
			value = JSON.parse(new TextDecoder().decode(decoded));
		} catch {
			throw new Error('Invalid account key bundle.');
		}
		const result = accountKeyBundleSchema.safeParse(value);
		if (!result.success) throw new Error('Invalid account key bundle.');
		const data = result.data;
		if (
			data.ownerId !== ownerId ||
			data.encryptionPublicKey !== encryptionPublicKey ||
			data.signingPublicKey !== signingPublicKey
		)
			throw new Error('The device key does not match this account.');
		const keys: AccountKeys = {
			root: fromBase64(data.root, 32),
			encryption: {
				publicKey: fromBase64(data.encryptionPublicKey, 32),
				privateKey: fromBase64(data.encryptionPrivateKey, 32)
			},
			signing: {
				publicKey: fromBase64(data.signingPublicKey, 32),
				privateKey: fromBase64(data.signingPrivateKey, 64)
			}
		};
		const derivedSigning = library.crypto_sign_seed_keypair(
			keys.signing.privateKey.subarray(0, 32)
		);
		const validSigning =
			library.memcmp(derivedSigning.privateKey, keys.signing.privateKey) &&
			library.memcmp(derivedSigning.publicKey, keys.signing.publicKey);
		library.memzero(derivedSigning.privateKey);
		if (
			!library.memcmp(
				library.crypto_scalarmult_base(keys.encryption.privateKey),
				keys.encryption.publicKey
			) ||
			!validSigning
		) {
			destroyAccountKeys(keys);
			throw new Error('The account key is damaged.');
		}
		return keys;
	} finally {
		library.memzero(decoded);
	}
}

export async function signDeviceTransfer(
	keys: AccountKeys,
	ownerId: string,
	deviceId: string,
	publicKey: string,
	wrappedKey: string
): Promise<string> {
	return toBase64(
		(await sodium()).crypto_sign_detached(
			new TextEncoder().encode(deviceTransferMessage(ownerId, deviceId, publicKey, wrappedKey)),
			keys.signing.privateKey
		)
	);
}
function deviceTransferMessage(
	ownerId: string,
	deviceId: string,
	publicKey: string,
	wrappedKey: string
): string {
	return ['kaordo-device-v1', ownerId, deviceId, publicKey, wrappedKey].join('\n');
}
export async function signDeviceRemoval(
	keys: AccountKeys,
	ownerId: string,
	device: { id: string; publicKey: string; wrappedKeys: string }
): Promise<string> {
	return toBase64(
		(await sodium()).crypto_sign_detached(
			new TextEncoder().encode(
				['kaordo-device-forget-v1', ownerId, device.id, device.publicKey, device.wrappedKeys].join(
					'\n'
				)
			),
			keys.signing.privateKey
		)
	);
}

export function destroyAccountKeys(keys: AccountKeys): void {
	keys.root.fill(0);
	keys.encryption.privateKey.fill(0);
	keys.signing.privateKey.fill(0);
}

export async function deviceFingerprint(publicKey: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64(publicKey, 32)));
	return [digest.subarray(0, 4), digest.subarray(4, 8), digest.subarray(8, 12)]
		.map((group) => Array.from(group, (byte) => byte.toString(16).padStart(2, '0')).join(''))
		.join(' ')
		.toUpperCase();
}
