// Validates and normalizes persisted tus upload URLs before resuming them
import { defaultOptions } from 'tus-js-client';

const uploadPathPattern = /^\/v1\/uploads\/[0-9a-f-]{36}$/i;

export function uploadStorage(baseUrl: string, storage = defaultOptions.urlStorage) {
	const origin = new URL(baseUrl);

	async function findUploadsByFingerprint(fingerprint: string) {
		const previous = await storage.findUploadsByFingerprint(fingerprint);
		const usable: typeof previous = [];

		for (const upload of previous) {
			const uploadUrl = normalizeUploadUrl(upload.uploadUrl, origin);
			if (!uploadUrl) {
				await storage.removeUpload(upload.urlStorageKey);
				continue;
			}

			usable.push({ ...upload, uploadUrl });
		}

		return usable;
	}

	return {
		findAllUploads: () => storage.findAllUploads(),
		findUploadsByFingerprint,
		removeUpload: (key: string) => storage.removeUpload(key),
		addUpload: (fingerprint: string, upload: Parameters<typeof storage.addUpload>[1]) =>
			storage.addUpload(fingerprint, upload)
	};
}

function normalizeUploadUrl(uploadUrl: string | null | undefined, origin: URL): string | null {
	let url: URL;
	try {
		url = new URL(uploadUrl ?? '');
	} catch {
		return null;
	}

	upgradeLegacyProtocol(url, origin);
	if (!isNodoUploadUrl(url, origin)) return null;
	return url.href;
}

function upgradeLegacyProtocol(url: URL, origin: URL): void {
	const isLegacySecureHost =
		origin.protocol === 'https:' && url.protocol === 'http:' && url.host === origin.host;
	if (isLegacySecureHost) url.protocol = 'https:';
}

function isNodoUploadUrl(url: URL, origin: URL): boolean {
	return (
		url.origin === origin.origin && uploadPathPattern.test(url.pathname) && !url.search && !url.hash
	);
}
