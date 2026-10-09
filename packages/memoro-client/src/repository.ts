// Loads ciphertext through TanStack Query and decrypts diary content and attachments on the device
import { QueryClient } from '@tanstack/svelte-query';
import {
	createMemoroApi,
	memoroMonthOptions,
	memoroDayOptions,
	memoroKeys
} from '@kaordo/api-client';
import {
	encryptionSession,
	privateCipher,
	decryptedObjectURL,
	releaseDecryptedURL,
	readResponseBytes
} from '@kaordo/crypto';
import type { DraftAttachment } from '@kaordo/editor-ui';
import type { MediaAttachment } from '@kaordo/media-ui';
import type { MemoroDay } from '@kaordo/contracts';
import {
	dayAttachments,
	emptyDay,
	summarize,
	validateDay,
	validateSummary,
	type DayDocument,
	type DaySummary,
	type StoredMedia
} from './model.ts';

export function createMemoroRepository(apiBaseUrl: string, nodoBaseUrl: string) {
	const session = encryptionSession();
	const cipher = privateCipher(session.keys, session.ownerId, 'memoro', session.signal);
	void cipher.catch(() => {});
	const api = createMemoroApi(apiBaseUrl, nodoBaseUrl);
	const queries = new QueryClient({ defaultOptions: { queries: { gcTime: 60_000 } } });
	const mediaURLs = new Map<string, string>();
	let disposed = false;
	const tag = async (date: string) => (await cipher).index(`day:${date}`);
	// Shared queries are cancelled only by TanStack or the key session; each caller abandons its own wait.
	async function shared<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
		signal.throwIfAborted();
		const result = await work;
		signal.throwIfAborted();
		return result;
	}
	const monthTag = async (month: string) => (await cipher).index(`month:${month}`);

	async function month(month: string, signal: AbortSignal): Promise<DaySummary[]> {
		const c = await cipher;
		const index = await monthTag(month);
		const summaries = await shared(
			queries.fetchQuery({
				...memoroMonthOptions(api, index),
				queryFn: ({ signal: request }) =>
					api.month(index, AbortSignal.any([request, session.signal]))
			}),
			signal
		);
		return Promise.all(
			summaries.items.map(async (value) => {
				const summary = validateSummary(
					await c.openJSON<unknown>(value, `summary:${value.dayTag}`)
				);
				if (
					!summary.date?.startsWith(month + '-') ||
					!Array.isArray(summary.colors) ||
					value.dayTag !== (await tag(summary.date))
				)
					throw new Error('The encrypted calendar summary is damaged.');
				return summary;
			})
		);
	}
	async function day(
		date: string,
		reload = false,
		signal: AbortSignal
	): Promise<{ document: DayDocument; revision: number; record: MemoroDay | null }> {
		const dayTag = await tag(date);
		if (reload) await queries.invalidateQueries({ queryKey: memoroKeys.day(dayTag) });
		const record = await shared(
			queries.fetchQuery({
				...memoroDayOptions(api, dayTag),
				queryFn: ({ signal: request }) =>
					api.day(dayTag, AbortSignal.any([request, session.signal]))
			}),
			signal
		);
		const document = record
			? validateDay(await (await cipher).openJSON<DayDocument>(record, `day:${dayTag}`), date)
			: emptyDay(date);
		return { document, revision: record?.revision ?? 0, record };
	}
	async function save(
		document: DayDocument,
		revision: number,
		signal: AbortSignal
	): Promise<MemoroDay> {
		validateDay(document, document.date);
		const dayTag = await tag(document.date);
		const month = await monthTag(document.date.slice(0, 7));
		const c = await cipher;
		const [encrypted, summary] = await Promise.all([
			c.sealJSON(document, `day:${dayTag}`),
			c.sealJSON(summarize(document), `summary:${dayTag}`)
		]);
		signal.throwIfAborted();
		const record = await api.saveDay(
			dayTag,
			{
				...encrypted,
				monthTag: month,
				revision,
				summary,
				attachmentIds: dayAttachments(document).map((media) => media.id)
			},
			signal
		);
		queries.setQueryData(memoroKeys.day(dayTag), record);
		await queries.invalidateQueries({ queryKey: memoroKeys.month(month) });
		return record;
	}
	async function upload(
		date: string,
		files: DraftAttachment[],
		signal: AbortSignal,
		progress: (value: number) => void
	): Promise<StoredMedia[]> {
		// Upload libraries load with the first attachment, keeping them out of the initial page and server render.
		const { uploadMedia, prepareImage, mediaDimensions } = await import('@kaordo/media-client');
		const c = await cipher;
		const descriptors: Omit<StoredMedia, 'id'>[] = [];
		const encrypted: File[] = [];
		for (const attachment of files) {
			signal.throwIfAborted();
			const file = await prepareImage(attachment.file);
			const context = `${date}/media/${crypto.randomUUID()}`;
			const dimensions = await mediaDimensions(file, signal);
			const plain = await file.arrayBuffer();
			let sealed: Awaited<ReturnType<typeof c.sealBytes>>;
			try {
				sealed = await c.sealBytes(plain, context);
			} finally {
				new Uint8Array(plain).fill(0);
			}
			encrypted.push(
				new File([sealed.bytes], crypto.randomUUID() + '.bin', { type: 'application/octet-stream' })
			);
			descriptors.push({
				kind: file.type.startsWith('image/') ? 'image' : 'video',
				mimeType: file.type,
				width: dimensions.width,
				height: dimensions.height,
				size: file.size,
				altText: attachment.altText,
				nonce: sealed.nonce,
				context
			});
		}
		const ids = await uploadMedia(encrypted, nodoBaseUrl, api, progress, {
			allowFiles: true,
			encrypt: false,
			maxFiles: 4,
			signal
		});
		return ids.map((id, index) => ({ id, ...descriptors[index] }));
	}
	async function media(
		document: DayDocument,
		record: MemoroDay | null,
		signal: AbortSignal
	): Promise<MediaAttachment[]> {
		if (!record) return [];
		const c = await cipher;
		const result: MediaAttachment[] = [];
		// Video bytes are opened only when the player is selected
		for (const item of dayAttachments(document)) {
			signal.throwIfAborted();
			const open = async (request: AbortSignal) => {
				let url = mediaURLs.get(item.id);
				if (url) return url;
				const source = record.media.find((value) => value.id === item.id);
				if (!source?.url) throw new Error('An encrypted attachment is unavailable.');
				const response = await fetch(source.url, {
					signal: AbortSignal.any([request, session.signal]),
					credentials: 'omit',
					cache: 'no-store'
				});
				if (!response.ok) throw new Error('An encrypted attachment could not load.');
				const encrypted = await readResponseBytes(response, item.size + 16);
				const bytes = await c.openBytes(encrypted.buffer, item.nonce, item.context);
				try {
					request.throwIfAborted();
					if (disposed) throw new DOMException('Disposed', 'AbortError');
					url = decryptedObjectURL(new Blob([bytes], { type: item.mimeType }));
					mediaURLs.set(item.id, url);
					return url;
				} finally {
					new Uint8Array(bytes).fill(0);
				}
			};
			result.push({
				...item,
				url: item.kind === 'video' ? '' : await open(signal),
				...(item.kind === 'video' ? { loadURL: open } : {})
			});
		}
		return result;
	}
	function clearMedia() {
		for (const url of mediaURLs.values()) releaseDecryptedURL(url);
		mediaURLs.clear();
	}
	return {
		month,
		day,
		save,
		upload,
		media,
		clearMedia,
		dispose() {
			disposed = true;
			void queries.cancelQueries();
			queries.clear();
			clearMedia();
		}
	};
}
