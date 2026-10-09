// Creates printable random recovery secrets and sealed account backups without server-readable private keys
import {
	sodium,
	toBase64,
	fromBase64,
	wrapAccountKeys,
	unwrapAccountKeys,
	type AccountKeys
} from './keys.ts';
export interface RecoveryFile {
	format: 'kaordo-recovery';
	version: 1;
	ownerId: string;
	encryptionPublicKey: string;
	signingPublicKey: string;
	secret: string;
}
export async function createRecovery(keys: AccountKeys, ownerId: string, previous = '') {
	const library = await sodium();
	const seed = library.randombytes_buf(32);
	const pair = library.crypto_box_seed_keypair(seed);
	try {
		const wrappedKeys = await wrapAccountKeys(keys, toBase64(pair.publicKey), ownerId);
		const file: RecoveryFile = {
			format: 'kaordo-recovery',
			version: 1,
			ownerId,
			encryptionPublicKey: toBase64(keys.encryption.publicKey),
			signingPublicKey: toBase64(keys.signing.publicKey),
			secret: toBase64(seed)
		};
		const signature = toBase64(
			library.crypto_sign_detached(
				new TextEncoder().encode(['kaordo-recovery-v1', ownerId, previous, wrappedKeys].join('\n')),
				keys.signing.privateKey
			)
		);
		return { file, update: { expectedWrappedKeys: previous, wrappedKeys, signature } };
	} finally {
		library.memzero(seed);
		library.memzero(pair.privateKey);
	}
}
export async function restoreRecovery(
	secret: string,
	wrappedKeys: string,
	ownerId: string,
	encryptionPublicKey: string,
	signingPublicKey: string
): Promise<AccountKeys> {
	const library = await sodium();
	const seed = fromBase64(secret.trim(), 32);
	const pair = library.crypto_box_seed_keypair(seed);
	try {
		return await unwrapAccountKeys(
			wrappedKeys,
			pair,
			ownerId,
			encryptionPublicKey,
			signingPublicKey
		);
	} finally {
		library.memzero(seed);
		library.memzero(pair.privateKey);
	}
}
export function parseRecoveryFile(
	text: string,
	ownerId: string,
	encryptionPublicKey: string,
	signingPublicKey: string
): string {
	if (text.length > 2048) throw new Error('Choose a Kaordo recovery file.');
	const value = JSON.parse(text) as RecoveryFile;
	if (
		value.format !== 'kaordo-recovery' ||
		value.version !== 1 ||
		value.ownerId !== ownerId ||
		value.encryptionPublicKey !== encryptionPublicKey ||
		value.signingPublicKey !== signingPublicKey
	)
		throw new Error('This recovery file belongs to another account or encryption identity.');
	fromBase64(value.secret, 32);
	return value.secret;
}
