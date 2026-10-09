// Scopes device-held keys and decrypted media URLs to one authenticated application
import { destroyAccountKeys, type AccountKeys } from './keys.ts';

export interface EncryptionSession {
	ownerId: string;
	keys: AccountKeys;
	signal: AbortSignal;
}
let current: EncryptionSession | undefined;
const urls = new Set<string>();

export function encryptionSession(): EncryptionSession {
	if (!current || current.signal.aborted)
		throw new Error('Unlock this device before opening encrypted data.');
	return current;
}

export function installEncryptionSession(
	ownerId: string,
	keys: AccountKeys,
	signal: AbortSignal
): () => void {
	if (current) throw new Error('An encryption session is already open.');
	signal.throwIfAborted();
	const lifetime = new AbortController();
	const session = { ownerId, keys, signal: lifetime.signal };
	current = session;
	const release = () => {
		if (current !== session) return;
		current = undefined;
		signal.removeEventListener('abort', release);
		lifetime.abort();
		destroyAccountKeys(keys);
		for (const url of urls) URL.revokeObjectURL(url);
		urls.clear();
	};
	signal.addEventListener('abort', release, { once: true });
	return release;
}

export function decryptedObjectURL(blob: Blob): string {
	encryptionSession();
	const url = URL.createObjectURL(blob);
	urls.add(url);
	return url;
}
export function releaseDecryptedURL(url: string): void {
	URL.revokeObjectURL(url);
	urls.delete(url);
}
