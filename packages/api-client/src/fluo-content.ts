// Converts audience-key encrypted post bodies and notification previews into Fluo presentation models
import {
	documentPlainText,
	documentSchema,
	type FluoDocument,
	type FluoMedia,
	type FluoPost,
	type FluoWirePost,
	type FluoNewPost,
	type FluoQuote,
	type FluoWireQuote,
	type FluoNotification,
	type FluoWireNotification
} from '@kaordo/contracts';
import { z } from 'zod';
import {
	isFluoEnvelope,
	fluoTextEnvelope,
	encryptionSession,
	encryptedMediaSchema,
	sealKeyring,
	openKeyring,
	sortedRefs,
	type EncryptedMedia,
	type KeyRef
} from '@kaordo/crypto';
import type { ContentCodec } from './content-codec.ts';
import type { FluoKeys } from './fluo-keys.ts';

interface PostContent {
	content: FluoDocument;
	text: string;
	media: EncryptedMedia[];
	parentId: string | null;
	quoteId: string | null;
}
const postSchema = z.strictObject({
	content: documentSchema,
	text: z.string().max(10000),
	media: z.array(encryptedMediaSchema).max(4),
	parentId: z.uuid().nullable(),
	quoteId: z.uuid().nullable()
});
const unavailable = 'This post is unavailable on this device.';
const unavailableDocument: FluoDocument = {
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: unavailable }] }]
};

export function createFluoContent(
	codec: ContentCodec,
	keys: FluoKeys,
	parentKeyring: (id: string) => Promise<KeyRef[]>
) {
	const keyrings = new Map<string, KeyRef[]>();
	encryptionSession().signal.addEventListener('abort', () => keyrings.clear(), { once: true });

	// Missing grants, unsigned text and damaged envelopes all render as unavailable rather than trusted content.
	async function open(
		envelope: unknown,
		id: string,
		signal?: AbortSignal
	): Promise<PostContent | null> {
		try {
			if (!isFluoEnvelope(envelope)) return null;
			keyrings.set(id, envelope.keyring);
			const resolved = await keys.resolve(envelope.keyring);
			if (!resolved) return null;
			const author = await codec.identity(envelope.senderId);
			const body = await openKeyring<PostContent>(
				envelope,
				author.signingPublicKey,
				resolved,
				`fluo:${id}`
			);
			return postSchema.safeParse(body).success && body.text === documentPlainText(body.content)
				? body
				: null;
		} catch (cause) {
			if (signal?.aborted || encryptionSession().signal.aborted) throw cause;
			return null;
		}
	}
	const textEnvelope = (text: string) => {
		try {
			return fluoTextEnvelope(text);
		} catch {
			return null;
		}
	};
	async function keyringFor(
		visibility: FluoNewPost['visibility'],
		parentId?: string
	): Promise<KeyRef[]> {
		const ownerId = encryptionSession().ownerId;
		if (visibility === 'private') return [{ ownerId, version: 0 }];
		const inherited = parentId ? (keyrings.get(parentId) ?? (await parentKeyring(parentId))) : [];
		return sortedRefs([
			...inherited.filter((ref) => ref.ownerId !== ownerId),
			{ ownerId, version: await keys.current() }
		]);
	}
	async function encode(input: FluoNewPost, id: string = crypto.randomUUID()) {
		documentSchema.parse(input.content);
		const text = documentPlainText(input.content);
		const limit = input.parentId ? 2000 : 5000;
		if ([...text].length > limit)
			throw new Error(`Use at most ${limit.toLocaleString('en')} characters.`);
		if (!text && !input.attachmentIds?.length && !input.quoteId)
			throw new Error('Write something or attach media before publishing.');
		const media = codec.attachments(input.attachmentIds, input.altTexts);
		const keyring = await keyringFor(input.visibility, input.parentId);
		const resolved = await keys.resolve(keyring);
		if (!resolved) throw new Error('You no longer have access to this conversation.');
		const content = await sealKeyring(
			{
				content: input.content,
				text,
				media,
				parentId: input.parentId ?? null,
				quoteId: input.quoteId ?? null
			},
			`fluo:${id}`,
			keyring,
			resolved
		);
		return { ...input, id, content, altTexts: {} };
	}
	async function quote(value: FluoWireQuote, signal?: AbortSignal): Promise<FluoQuote> {
		const body = await open(textEnvelope(value.text), value.id, signal);
		if (!body) return { ...value, text: unavailable, media: [] };
		return {
			...value,
			text: body.text,
			media: (await codec.media(value.media, body.media, signal)) as FluoMedia[]
		};
	}
	async function post(
		value: FluoWirePost,
		signal?: AbortSignal,
		preview = false
	): Promise<FluoPost> {
		const body = await open(value.content, value.id, signal);
		const quoted = !preview && value.quote ? await quote(value.quote, signal) : null;
		if (!body)
			return {
				...value,
				content: unavailableDocument,
				text: unavailable,
				media: [],
				quote: quoted
			};
		if (
			(value.parentId ?? null) !== body.parentId ||
			((value.quoteId ?? null) !== body.quoteId && !value.quoteDeleted)
		)
			return { ...value, content: unavailableDocument, text: unavailable, media: [], quote: null };
		return {
			...value,
			content: body.content,
			text: body.text,
			media: preview ? [] : ((await codec.media(value.media, body.media, signal)) as FluoMedia[]),
			quote: quoted
		};
	}
	async function notification(
		value: FluoWireNotification,
		signal?: AbortSignal
	): Promise<FluoNotification> {
		if (!value.post) return { ...value, post: null };
		const body = await open(textEnvelope(value.post.text), value.post.id, signal);
		if (!body) return { ...value, post: { ...value.post, text: unavailable, media: [] } };
		return {
			...value,
			post: {
				...value.post,
				text: body.text,
				media: (await codec.media(value.post.media, body.media, signal, true)) as FluoMedia[]
			}
		};
	}
	return { encode, post, notification, quote };
}
