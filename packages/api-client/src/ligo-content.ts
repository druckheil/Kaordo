// Encrypts chat messages and group titles while preserving Ligo's delivery and pagination models
import type { LigoConversation, LigoMessage, LigoNewMessage } from '@kaordo/contracts';
import { z } from 'zod';
import {
	envelopeText,
	textEnvelope,
	encryptionSession,
	sealContent,
	encryptedMediaSchema,
	type EncryptedMedia
} from '@kaordo/crypto';
import type { ContentCodec } from './content-codec.ts';
interface Body {
	text: string;
	media: EncryptedMedia[];
}
const bodySchema = z.strictObject({
	text: z
		.string()
		.max(8000)
		.refine((value) => Array.from(value).length <= 4000),
	media: z.array(encryptedMediaSchema).max(8)
});
const unavailableMessage = 'This message is unavailable on this device.';
function requireEnvelope(text: string) {
	const envelope = textEnvelope(text);
	if (!envelope) throw new Error('The message is not encrypted.');
	return envelope;
}
export function createLigoContent(codec: ContentCodec) {
	const decoded = new Map<string, { body: Body; clientId: string }>();
	encryptionSession().signal.addEventListener('abort', () => decoded.clear(), { once: true });
	async function message(value: LigoMessage, signal?: AbortSignal): Promise<LigoMessage> {
		if (value.deleted || value.systemNotice) return value;
		let body: Body;
		// Unsigned text and history sealed before this member joined are shown as unavailable instead of trusted.
		try {
			body = bodySchema.parse(
				await codec.open<Body>(
					requireEnvelope(value.text),
					value.sender.id,
					`ligo:${value.conversationId}:${value.clientId}`
				)
			);
		} catch (cause) {
			if (signal?.aborted) throw cause;
			return { ...value, text: unavailableMessage, media: [] };
		}
		decoded.set(value.id, { body, clientId: value.clientId });
		return {
			...value,
			text: body.text,
			media: codec.media(value.media, body.media, signal)
		};
	}
	async function conversation(value: LigoConversation): Promise<LigoConversation> {
		// Unencrypted titles are never displayed; direct conversations are named after their members.
		let title = '';
		const envelope = textEnvelope(value.title);
		if (envelope) {
			const context =
				value.kind === 'group'
					? `ligo-group:${value.id}`
					: value.channel
						? `rondo-channel:${value.channel.serverId}:${value.channel.id}`
						: '';
			if (!context) throw new Error('The encrypted conversation identity is unavailable.');
			const body = await codec.open<{ title?: string; name?: string }>(
				envelope,
				value.createdBy,
				context
			);
			title = body.title ?? body.name ?? '';
			if (typeof title !== 'string' || !title.trim() || Array.from(title).length > 100)
				throw new Error('The encrypted conversation title is damaged.');
		}
		const last = value.lastMessage;
		if (!last || last.deleted || last.systemNotice) return { ...value, title };
		let text = unavailableMessage;
		try {
			text = bodySchema.parse(
				await codec.open<Body>(
					requireEnvelope(last.text),
					last.senderId,
					`ligo:${value.id}:${last.clientId}`
				)
			).text;
		} catch {
			/* shown as unavailable */
		}
		return { ...value, title, lastMessage: { ...last, text } };
	}
	async function encode(id: string, input: LigoNewMessage) {
		if (Array.from(input.text).length > 4000)
			throw new Error('A message can contain up to 4,000 characters.');
		const body = {
			text: input.text,
			media: codec.attachments(input.attachmentIds, input.altTexts)
		};
		return {
			...input,
			text: envelopeText(await codec.seal(body, `ligo:${id}:${input.clientId}`, 'ligo', id)),
			altTexts: {}
		};
	}
	async function edit(id: string, messageId: string, text: string) {
		if (Array.from(text).length > 4000)
			throw new Error('A message can contain up to 4,000 characters.');
		const previous = decoded.get(messageId);
		if (!previous) throw new Error('Reload this message before editing it.');
		return envelopeText(
			await codec.seal(
				{ ...previous.body, text },
				`ligo:${id}:${previous.clientId}`,
				'ligo-history',
				messageId
			)
		);
	}
	async function title(title: string, participantIds: string[], id: string) {
		if (Array.from(title).length > 100)
			throw new Error('Use up to 100 characters for a group title.');
		const users = await Promise.all(
			[...new Set([encryptionSession().ownerId, ...participantIds])].map((id) => codec.identity(id))
		);
		return envelopeText(await sealContent({ title }, `ligo-group:${id}`, { public: false, users }));
	}
	return { message, conversation, encode, edit, title };
}
