// Encrypts opaque media bytes and retains descriptors only inside encrypted content
import { fromBase64, toBase64 } from './keys.ts';
import { encryptionSession, type EncryptionSession } from './session.ts';
import { createDecryptedMediaCache } from './media-cache.ts';
import { encryptedMediaSchema } from './validation.ts';
import { readResponseBytes } from './bytes.ts';

export interface EncryptedMedia {
	id: string;
	kind: 'image' | 'video' | 'file';
	mimeType: string;
	filename: string;
	width: number;
	height: number;
	size: number;
	altText: string;
	key: string;
	context: string;
}
const descriptors = new Map<string, EncryptedMedia>();
let cache: ReturnType<typeof createDecryptedMediaCache> | undefined;
let activeSession: EncryptionSession | undefined;
function activate() {
	const session = encryptionSession();
	if (activeSession === session && cache) return cache;
	clearMediaSecrets();
	activeSession = session;
	cache = createDecryptedMediaCache(session.signal);
	session.signal.addEventListener('abort', clearMediaSecrets, { once: true });
	return cache;
}
const header = new TextEncoder().encode('Kaordo01');
export function rememberMedia(value: EncryptedMedia): void {
	activate();
	if (!encryptedMediaSchema.safeParse(value).success)
		throw new Error('The encrypted attachment descriptor is damaged.');
	const previous = descriptors.get(value.id);
	if (previous && (previous.key !== value.key || previous.context !== value.context))
		throw new Error('The attachment encryption identity changed.');
	descriptors.set(value.id, value);
}
export function hasMediaKey(id: string): boolean {
	activate();
	return descriptors.has(id);
}
export function mediaDescriptor(id: string): EncryptedMedia {
	activate();
	const item = descriptors.get(id);
	if (!item) throw new Error('An attachment encryption key is unavailable. Add the file again.');
	return { ...item };
}
export function clearMediaSecrets(): void {
	cache?.clear();
	cache = undefined;
	descriptors.clear();
	activeSession = undefined;
}
export async function encryptMedia(
	file: File,
	dimensions: { width: number; height: number }
): Promise<{ file: File; descriptor: Omit<EncryptedMedia, 'id'> }> {
	activate();
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const context = crypto.randomUUID();
	const plain = await file.arrayBuffer();
	let bytes: ArrayBuffer;
	try {
		bytes = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(context) },
			key,
			plain
		);
	} finally {
		new Uint8Array(plain).fill(0);
	}
	const visual = dimensions.width > 0 && dimensions.height > 0;
	return {
		file: new File([header, nonce, bytes], context + '.bin', { type: 'application/octet-stream' }),
		descriptor: {
			kind:
				visual && file.type.startsWith('image/')
					? 'image'
					: visual && file.type.startsWith('video/')
						? 'video'
						: 'file',
			mimeType: file.type || 'application/octet-stream',
			filename: file.name,
			size: file.size,
			width: dimensions.width,
			height: dimensions.height,
			altText: '',
			key: toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key))),
			context
		}
	};
}
export async function decryptMedia(
	item: EncryptedMedia,
	source: string,
	signal: AbortSignal
): Promise<string> {
	signal.throwIfAborted();
	const media = activate();
	rememberMedia(item);
	return media.open(
		item.id,
		async (request) => {
			const response = await fetch(source, {
				signal: request,
				credentials: 'omit',
				cache: 'no-store'
			});
			if (!response.ok) throw new Error('The encrypted attachment could not load.');
			const data = await readResponseBytes(response, item.size + 36);
			if (data.length < 36 || !header.every((byte, index) => data[index] === byte))
				throw new Error('Invalid encrypted media.');
			const key = await crypto.subtle.importKey(
				'raw',
				fromBase64(item.key, 32),
				{ name: 'AES-GCM' },
				false,
				['decrypt']
			);
			const bytes = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: data.subarray(8, 20),
					additionalData: new TextEncoder().encode(item.context)
				},
				key,
				data.subarray(20)
			);
			try {
				request.throwIfAborted();
				return new Blob([bytes], {
					type: item.kind === 'file' ? 'application/octet-stream' : item.mimeType
				});
			} finally {
				new Uint8Array(bytes).fill(0);
			}
		},
		signal
	);
}
