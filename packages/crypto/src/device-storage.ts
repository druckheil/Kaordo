// Persists each device's private key under a nonextractable browser encryption key
import { openDB } from 'idb';
import { createDeviceKeys, fromBase64, toBase64, type KeyPair } from './keys.ts';

interface StoredDevice {
	id: string;
	publicKey: string;
	privateKey: ArrayBuffer;
	nonce: Uint8Array<ArrayBuffer>;
	storageKey: CryptoKey;
	accountPublicKey?: string;
}
export interface LocalDevice {
	id: string;
	keys: KeyPair;
	accountPublicKey?: string;
}

async function database() {
	return openDB('kaordo-device-keys', 2, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('devices')) db.createObjectStore('devices');
			if (!db.objectStoreNames.contains('peers')) db.createObjectStore('peers');
		}
	});
}

export async function localDevice(ownerId: string): Promise<LocalDevice> {
	if (!globalThis.crypto?.subtle) throw new Error('Encryption requires HTTPS or localhost.');
	const db = await database();
	try {
		let device: StoredDevice | undefined = await db.get('devices', ownerId);
		if (!device) {
			const pair = await createDeviceKeys();
			const storageKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
				'encrypt',
				'decrypt'
			]);
			const nonce = crypto.getRandomValues(new Uint8Array(12));
			const privateKey = await crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(ownerId) },
				storageKey,
				pair.privateKey as Uint8Array<ArrayBuffer>
			);
			device = {
				id: crypto.randomUUID(),
				publicKey: toBase64(pair.publicKey),
				privateKey,
				nonce,
				storageKey
			};
			pair.privateKey.fill(0);
			// The read/write transaction settles simultaneous first visits in separate tabs
			const transaction = db.transaction('devices', 'readwrite');
			const existing = await transaction.store.get(ownerId);
			if (existing) device = existing;
			else await transaction.store.put(device, ownerId);
			await transaction.done;
		}
		if (!device) throw new Error('Device storage could not be initialized.');
		const privateKey = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: device.nonce, additionalData: new TextEncoder().encode(ownerId) },
			device.storageKey,
			device.privateKey
		);
		return {
			id: device.id,
			accountPublicKey: device.accountPublicKey,
			keys: { publicKey: fromBase64(device.publicKey, 32), privateKey: new Uint8Array(privateKey) }
		};
	} finally {
		db.close();
	}
}

export async function pinAccountKey(ownerId: string, publicKey: string): Promise<void> {
	const db = await database();
	try {
		const transaction = db.transaction('devices', 'readwrite');
		const device = (await transaction.store.get(ownerId)) as StoredDevice;
		if (!device || (device.accountPublicKey && device.accountPublicKey !== publicKey))
			throw new Error('The account encryption identity changed.');
		await transaction.store.put({ ...device, accountPublicKey: publicKey }, ownerId);
		await transaction.done;
	} finally {
		db.close();
	}
}

export async function pinPeerIdentity(
	ownerId: string,
	peerId: string,
	publicKey: string,
	signingKey: string
): Promise<void> {
	const db = await database();
	try {
		const transaction = db.transaction('peers', 'readwrite');
		const id = `${ownerId}:${peerId}`;
		const previous = (await transaction.store.get(id)) as
			{ publicKey: string; signingKey: string } | undefined;
		if (previous && (previous.publicKey !== publicKey || previous.signingKey !== signingKey)) {
			transaction.abort();
			throw new Error(
				'A contact encryption identity changed. Verify their keys before continuing.'
			);
		}
		if (!previous) await transaction.store.put({ publicKey, signingKey }, id);
		await transaction.done;
	} finally {
		db.close();
	}
}
