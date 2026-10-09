// Authenticates content envelopes and seals per-record keys to their intended accounts
import { sodium, fromBase64, toBase64 } from './keys.ts';
import { encryptionSession } from './session.ts';
import { contentEnvelopeSchema } from './validation.ts';

export interface PublicIdentity {
	id: string;
	encryptionPublicKey: string;
	signingPublicKey: string;
}
export interface RecipientKey {
	userId: string;
	key: string;
}
export interface ContentEnvelope {
	version: 1;
	context: string;
	senderId: string;
	nonce: string;
	ciphertext: string;
	keys: RecipientKey[];
	publicKey: string;
	signature: string;
}
export interface Audience {
	public: boolean;
	users: PublicIdentity[];
}
export const encryptedTextPrefix = 'kaordo:e2ee:v1:';
export function isContentEnvelope(value: unknown): value is ContentEnvelope {
	return contentEnvelopeSchema.safeParse(value).success;
}
export function envelopeText(value: ContentEnvelope): string {
	return encryptedTextPrefix + JSON.stringify(value);
}
export function textEnvelope(text: string): ContentEnvelope | null {
	if (!text.startsWith(encryptedTextPrefix)) return null;
	if (text.length > 524320) throw new Error('The encrypted content exceeds its size limit.');
	const value: unknown = JSON.parse(text.slice(encryptedTextPrefix.length));
	if (!isContentEnvelope(value)) throw new Error('Invalid encrypted content envelope.');
	return value;
}
function signatureMessage(value: Omit<ContentEnvelope, 'signature'>): Uint8Array {
	return new TextEncoder().encode(
		[
			'kaordo-content-v1',
			value.context,
			value.senderId,
			value.nonce,
			value.ciphertext,
			value.publicKey,
			...[...value.keys]
				.sort((a, b) => a.userId.localeCompare(b.userId))
				.map((key) => `${key.userId}:${key.key}`)
		].join('\n')
	);
}
export async function sealContent(
	value: unknown,
	context: string,
	audience: Audience
): Promise<ContentEnvelope> {
	const session = encryptionSession();
	const library = await sodium();
	session.signal.throwIfAborted();
	const key = library.randombytes_buf(32);
	try {
		const nonce = library.randombytes_buf(library.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
		const encrypted = library.crypto_aead_xchacha20poly1305_ietf_encrypt(
			new TextEncoder().encode(JSON.stringify(value)),
			new TextEncoder().encode(context),
			null,
			nonce,
			key
		);
		const recipients = new Map(audience.users.map((user) => [user.id, user.encryptionPublicKey]));
		recipients.set(session.ownerId, toBase64(session.keys.encryption.publicKey));
		if (recipients.size > 512)
			throw new Error('This encrypted audience exceeds the 512-account limit.');
		const keys = [...recipients].map(([userId, publicKey]) => ({
			userId,
			key: toBase64(library.crypto_box_seal(key, fromBase64(publicKey, 32)))
		}));
		const envelope = {
			version: 1 as const,
			context,
			senderId: session.ownerId,
			nonce: toBase64(nonce),
			ciphertext: toBase64(encrypted),
			keys,
			publicKey: audience.public ? toBase64(key) : ''
		};
		return {
			...envelope,
			signature: toBase64(
				library.crypto_sign_detached(signatureMessage(envelope), session.keys.signing.privateKey)
			)
		};
	} finally {
		library.memzero(key);
	}
}
export async function openContent<T>(
	envelope: ContentEnvelope,
	identity: PublicIdentity,
	context?: string
): Promise<T> {
	if (!isContentEnvelope(envelope)) throw new Error('Invalid encrypted content envelope.');
	const session = encryptionSession();
	const library = await sodium();
	session.signal.throwIfAborted();
	if (
		identity.id !== envelope.senderId ||
		(context && envelope.context !== context) ||
		!library.crypto_sign_verify_detached(
			fromBase64(envelope.signature, 64),
			signatureMessage(envelope),
			fromBase64(identity.signingPublicKey, 32)
		)
	)
		throw new Error('Encrypted content authenticity could not be verified.');
	const wrapped = envelope.keys.find((key) => key.userId === session.ownerId);
	const key = envelope.publicKey
		? fromBase64(envelope.publicKey, 32)
		: wrapped
			? library.crypto_box_seal_open(
					fromBase64(wrapped.key, 80),
					session.keys.encryption.publicKey,
					session.keys.encryption.privateKey
				)
			: null;
	if (!key) throw new ContentAccessError();
	let bytes: Uint8Array | undefined;
	try {
		bytes = library.crypto_aead_xchacha20poly1305_ietf_decrypt(
			null,
			fromBase64(envelope.ciphertext),
			new TextEncoder().encode(envelope.context),
			fromBase64(envelope.nonce, 24),
			key
		);
		return JSON.parse(new TextDecoder().decode(bytes)) as T;
	} finally {
		library.memzero(key);
		if (bytes) library.memzero(bytes);
	}
}
export class ContentAccessError extends Error {
	constructor() {
		super('This encrypted content is waiting for its author to grant access to your account.');
	}
}
