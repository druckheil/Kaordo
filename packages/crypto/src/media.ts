// Encrypts opaque media bytes and retains descriptors only inside encrypted content
import { fromBase64, toBase64 } from './keys.ts';
import { decryptedObjectURL, encryptionSession, type EncryptionSession } from './session.ts';
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
interface MediaLoad {
	promise: Promise<string>;
	controller: AbortController;
	readers: number;
	finished: boolean;
}
const opened = new Map<string, string>();
const loading = new Map<string, MediaLoad>();
let activeSession: EncryptionSession | undefined;
function activate() {
	const session = encryptionSession();
	if (activeSession === session) return;
	clearMediaSecrets();
	activeSession = session;
	session.signal.addEventListener('abort', clearMediaSecrets, { once: true });
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
	for (const load of loading.values()) load.controller.abort();
	loading.clear();
	descriptors.clear();
	opened.clear();
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
	signal?: AbortSignal
): Promise<string> {
	rememberMedia(item);
	signal?.throwIfAborted();
	const cached = opened.get(item.id);
	if (cached) return cached;
	let load = loading.get(item.id);
	if (load?.controller.signal.aborted) {
		loading.delete(item.id);
		load = undefined;
	}
	if (!load) {
		const controller = new AbortController();
		const combined = AbortSignal.any([encryptionSession().signal, controller.signal]);
		const promise = (async () => {
			const response = await fetch(source, {
				signal: combined,
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
				combined.throwIfAborted();
				const url = decryptedObjectURL(
					new Blob([bytes], {
						type: item.kind === 'file' ? 'application/octet-stream' : item.mimeType
					})
				);
				opened.set(item.id, url);
				return url;
			} finally {
				new Uint8Array(bytes).fill(0);
			}
		})();
		load = { promise, controller, readers: 0, finished: false };
		loading.set(item.id, load);
		const current = load;
		void promise
			.finally(() => {
				current.finished = true;
				if (loading.get(item.id) === current) loading.delete(item.id);
			})
			.catch(() => {
				// Readers receive the load failure through the original promise
			});
	}
	const current = load;
	current.readers++;
	return new Promise<string>((resolve, reject) => {
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			signal?.removeEventListener('abort', cancel);
			if (--current.readers === 0 && !current.finished) current.controller.abort();
		};
		const cancel = () => {
			release();
			const cause: unknown = signal?.reason;
			reject(cause instanceof Error ? cause : new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', cancel, { once: true });
		current.promise.then(
			(value) => {
				release();
				resolve(value);
			},
			(cause: unknown) => {
				release();
				reject(
					cause instanceof Error
						? cause
						: new Error('The encrypted attachment could not load.', { cause })
				);
			}
		);
		if (signal?.aborted) cancel();
	});
}
