// Shares decrypted media while consumers are mounted and releases bytes after the last consumer leaves
import { decryptedObjectURL, releaseDecryptedURL } from './session.ts';

interface MediaEntry {
	controller: AbortController;
	promise: Promise<string>;
	readers: number;
	url?: string;
}

export function createDecryptedMediaCache(lifetime: AbortSignal) {
	const entries = new Map<string, MediaEntry>();

	function remove(id: string, entry: MediaEntry): void {
		if (entries.get(id) === entry) entries.delete(id);
		entry.controller.abort();
		if (entry.url) releaseDecryptedURL(entry.url);
		entry.url = undefined;
	}
	function clear(): void {
		for (const [id, entry] of entries) remove(id, entry);
	}
	lifetime.addEventListener('abort', clear, { once: true });

	function open(
		id: string,
		load: (signal: AbortSignal) => Promise<Blob>,
		signal: AbortSignal
	): Promise<string> {
		lifetime.throwIfAborted();
		signal.throwIfAborted();
		let entry = entries.get(id);
		if (!entry) {
			const controller = new AbortController();
			const combined = AbortSignal.any([lifetime, controller.signal]);
			const current: MediaEntry = {
				controller,
				readers: 0,
				promise: Promise.resolve().then(async () => {
					combined.throwIfAborted();
					const blob = await load(combined);
					combined.throwIfAborted();
					current.url = decryptedObjectURL(blob);
					return current.url;
				})
			};
			entries.set(id, current);
			void current.promise.catch(() => remove(id, current));
			entry = current;
		}
		const current = entry;
		current.readers++;
		return new Promise<string>((resolve, reject) => {
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				signal.removeEventListener('abort', cancel);
				if (--current.readers === 0) remove(id, current);
			};
			const cancel = () => {
				release();
				reject(
					signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
				);
			};
			signal.addEventListener('abort', cancel, { once: true });
			current.promise.then(
				(url) => {
					if (!released) resolve(url);
				},
				(cause: unknown) => {
					release();
					reject(
						cause instanceof Error ? cause : new Error('The attachment could not load.', { cause })
					);
				}
			);
			if (signal.aborted) cancel();
		});
	}
	return { open, clear };
}
