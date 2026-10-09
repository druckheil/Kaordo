// Adapts signed encrypted wire content to application models and verifies pinned sender identities
import { createEncryptionApi, type AudienceModule } from './encryption.ts';
import {
	encryptionSession,
	pinPeerIdentity,
	toBase64,
	openContent,
	sealContent,
	decryptMedia,
	mediaDescriptor,
	rememberMedia,
	type PublicIdentity,
	type ContentEnvelope,
	type EncryptedMedia,
	type Audience
} from '@kaordo/crypto';

export function createContentCodec(baseUrl: string) {
	const api = createEncryptionApi(baseUrl);
	const session = encryptionSession();
	const identities = new Map<string, Promise<PublicIdentity>>();
	session.signal.addEventListener('abort', () => identities.clear(), { once: true });
	async function identity(id: string): Promise<PublicIdentity> {
		if (id === session.ownerId)
			return {
				id,
				encryptionPublicKey: toBase64(session.keys.encryption.publicKey),
				signingPublicKey: toBase64(session.keys.signing.publicKey)
			};
		let pending = identities.get(id);
		if (!pending) {
			pending = api.publicIdentity(id, session.signal).then(async (value) => {
				await pinPeerIdentity(
					session.ownerId,
					id,
					value.encryptionPublicKey,
					value.signingPublicKey
				);
				return value;
			});
			identities.set(id, pending);
			void pending.catch(() => {
				if (identities.get(id) === pending) identities.delete(id);
			});
		}
		return pending;
	}
	async function open<T>(value: ContentEnvelope, senderId: string, context?: string): Promise<T> {
		return openContent<T>(value, await identity(senderId), context);
	}
	async function audience(
		module: AudienceModule,
		id: string,
		privateContent = false
	): Promise<Audience> {
		const result = await api.audience(module, id, privateContent, session.signal);
		for (const user of result.users)
			await pinPeerIdentity(
				session.ownerId,
				user.id,
				user.encryptionPublicKey,
				user.signingPublicKey
			);
		return result;
	}
	async function seal(
		value: unknown,
		context: string,
		module: AudienceModule,
		id: string,
		privateContent = false
	) {
		return sealContent(value, context, await audience(module, id, privateContent));
	}
	function attachments(
		ids: string[] = [],
		altTexts: Record<string, string> = {}
	): EncryptedMedia[] {
		return ids.map((id) => ({
			...mediaDescriptor(id),
			altText: altTexts[id] ?? mediaDescriptor(id).altText
		}));
	}
	async function media<T extends { id: string; url?: string }>(
		items: T[],
		encrypted: EncryptedMedia[],
		signal?: AbortSignal,
		preview = false
	) {
		const result = [];
		for (const item of encrypted) {
			const source = items.find((value) => value.id === item.id);
			if (!source?.url) throw new Error('An encrypted media reference is unavailable.');
			rememberMedia(item);
			result.push({
				...source,
				...item,
				url: item.kind === 'video' ? '' : await decryptMedia(item, source.url, signal),
				...(item.kind === 'video' && !preview
					? { loadURL: (signal: AbortSignal) => decryptMedia(item, source.url!, signal) }
					: {})
			});
		}
		return result;
	}
	return { open, seal, audience, attachments, media, identity };
}
export type ContentCodec = ReturnType<typeof createContentCodec>;
