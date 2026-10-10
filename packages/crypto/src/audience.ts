// Derives author audience keys and encrypts Fluo content for every audience in its reply lineage
import { sodium, fromBase64, toBase64 } from './keys.ts';
import { encryptionSession } from './session.ts';
import { fluoEnvelopeSchema } from './validation.ts';

export interface KeyRef {
	ownerId: string;
	version: number;
}
export interface FluoEnvelope {
	version: 1;
	context: string;
	senderId: string;
	nonce: string;
	ciphertext: string;
	keyring: KeyRef[];
	signature: string;
}
const fluoTextPrefix = 'kaordo:fluo:v1:';

export function isFluoEnvelope(value: unknown): value is FluoEnvelope {
	return fluoEnvelopeSchema.safeParse(value).success;
}
export function fluoEnvelopeText(value: FluoEnvelope): string {
	return fluoTextPrefix + JSON.stringify(value);
}
export function fluoTextEnvelope(text: string): FluoEnvelope | null {
	if (!text.startsWith(fluoTextPrefix)) return null;
	const value: unknown = JSON.parse(text.slice(fluoTextPrefix.length));
	if (!isFluoEnvelope(value)) throw new Error('Invalid encrypted post envelope.');
	return value;
}

// Version 0 is the self-only key; every version is recomputed from the account root on each device.
export async function ownAudienceKey(version: number): Promise<Uint8Array> {
	const session = encryptionSession();
	const material = await crypto.subtle.importKey(
		'raw',
		session.keys.root as Uint8Array<ArrayBuffer>,
		'HKDF',
		false,
		['deriveBits']
	);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: new TextEncoder().encode(session.ownerId),
				info: new TextEncoder().encode(`kaordo/v1/fluo-audience/${version}`)
			},
			material,
			256
		)
	);
}
export async function sealAudienceKey(
	key: Uint8Array,
	recipientPublicKey: string
): Promise<string> {
	return toBase64((await sodium()).crypto_box_seal(key, fromBase64(recipientPublicKey, 32)));
}
export async function openAudienceKey(sealed: string): Promise<Uint8Array> {
	const { keys } = encryptionSession();
	return (await sodium()).crypto_box_seal_open(
		fromBase64(sealed, 80),
		keys.encryption.publicKey,
		keys.encryption.privateKey
	);
}

const refText = (refs: KeyRef[]) => refs.map((ref) => `${ref.ownerId}:${ref.version}`);
async function contentKey(
	context: string,
	refs: KeyRef[],
	keys: Uint8Array[]
): Promise<Uint8Array> {
	const joined = new Uint8Array(keys.length * 32);
	keys.forEach((key, index) => joined.set(key, index * 32));
	try {
		const material = await crypto.subtle.importKey('raw', joined, 'HKDF', false, ['deriveBits']);
		return new Uint8Array(
			await crypto.subtle.deriveBits(
				{
					name: 'HKDF',
					hash: 'SHA-256',
					salt: new TextEncoder().encode(context),
					info: new TextEncoder().encode(['kaordo-keyring-v1', ...refText(refs)].join('\n'))
				},
				material,
				256
			)
		);
	} finally {
		joined.fill(0);
	}
}
function signatureMessage(value: Omit<FluoEnvelope, 'signature'>): Uint8Array {
	return new TextEncoder().encode(
		[
			'kaordo-keyring-v1',
			value.context,
			value.senderId,
			value.nonce,
			value.ciphertext,
			...refText(value.keyring)
		].join('\n')
	);
}
export function sortedRefs(refs: KeyRef[]): KeyRef[] {
	return [...new Map(refs.map((ref) => [ref.ownerId, ref])).values()].sort((a, b) =>
		a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0
	);
}

// keys must follow the sorted keyring order
export async function sealKeyring(
	value: unknown,
	context: string,
	keyring: KeyRef[],
	keys: Uint8Array[]
): Promise<FluoEnvelope> {
	const session = encryptionSession();
	const library = await sodium();
	const key = await contentKey(context, keyring, keys);
	try {
		const nonce = library.randombytes_buf(library.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
		const ciphertext = library.crypto_aead_xchacha20poly1305_ietf_encrypt(
			new TextEncoder().encode(JSON.stringify(value)),
			new TextEncoder().encode(context),
			null,
			nonce,
			key
		);
		const envelope = {
			version: 1 as const,
			context,
			senderId: session.ownerId,
			nonce: toBase64(nonce),
			ciphertext: toBase64(ciphertext),
			keyring
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
export async function openKeyring<T>(
	envelope: FluoEnvelope,
	signingPublicKey: string,
	keys: Uint8Array[],
	context: string
): Promise<T> {
	const library = await sodium();
	if (
		!isFluoEnvelope(envelope) ||
		envelope.context !== context ||
		!library.crypto_sign_verify_detached(
			fromBase64(envelope.signature, 64),
			signatureMessage(envelope),
			fromBase64(signingPublicKey, 32)
		)
	)
		throw new Error('Encrypted post authenticity could not be verified.');
	const key = await contentKey(envelope.context, envelope.keyring, keys);
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
