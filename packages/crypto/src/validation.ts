// Validates cryptographic envelopes and attachment descriptors before allocating or opening data
import { z } from 'zod';
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const base64Bytes = (size: number) =>
	z
		.base64()
		.length(Math.ceil(size / 3) * 4)
		.refine((value) => {
			try {
				const bytes = atob(value);
				return bytes.length === size && btoa(bytes) === value;
			} catch {
				return false;
			}
		});
export const contentEnvelopeSchema = z
	.strictObject({
		version: z.literal(1),
		context: z
			.string()
			.min(6)
			.max(180)
			.regex(/^[^\r\n]+$/),
		senderId: id,
		nonce: base64Bytes(24),
		signature: base64Bytes(64),
		ciphertext: z.base64().min(24).max(524288),
		keys: z
			.array(z.strictObject({ userId: id, key: base64Bytes(80) }))
			.min(1)
			.max(512),
		publicKey: z.union([z.literal(''), base64Bytes(32)])
	})
	.refine(
		(value) =>
			new Set(value.keys.map((key) => key.userId)).size === value.keys.length &&
			value.keys.some((key) => key.userId === value.senderId)
	);
export const fluoEnvelopeSchema = z
	.strictObject({
		version: z.literal(1),
		context: z
			.string()
			.min(6)
			.max(180)
			.regex(/^[^\r\n]+$/),
		senderId: id,
		nonce: base64Bytes(24),
		signature: base64Bytes(64),
		ciphertext: z.base64().min(24).max(524288),
		keyring: z
			.array(z.strictObject({ ownerId: id, version: z.number().int().min(0) }))
			.min(1)
			.max(64)
	})
	.refine(
		(value) =>
			value.keyring.every(
				(ref, index) => index === 0 || value.keyring[index - 1].ownerId < ref.ownerId
			) && value.keyring.some((ref) => ref.ownerId === value.senderId)
	);
export const encryptedMediaSchema = z
	.strictObject({
		id,
		kind: z.enum(['image', 'video', 'file']),
		mimeType: z.string().min(1).max(200),
		filename: z.string().max(255),
		width: z.number().int().min(0).max(100000),
		height: z.number().int().min(0).max(100000),
		size: z
			.number()
			.int()
			.min(1)
			.max(100 * 1024 * 1024),
		altText: z.string().max(1000),
		key: base64Bytes(32),
		context: id
	})
	.refine((value) => value.kind === 'file' || (value.width > 0 && value.height > 0))
	.refine(
		(value) =>
			value.kind === 'file' ||
			(value.kind === 'image'
				? ['image/jpeg', 'image/png', 'image/webp']
				: ['video/mp4', 'video/webm', 'video/quicktime']
			).includes(value.mimeType)
	);
