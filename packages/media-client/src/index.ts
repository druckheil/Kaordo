// Prepares browser media and coordinates resumable Nodo uploads
import { encryptMedia, rememberMedia } from '@kaordo/crypto';
import { accessToken } from '@kaordo/auth';
import type { NodoUpload } from '@kaordo/contracts';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import { isSupportedImageType, MAX_IMAGE_SIZE, prepareImage } from './image-processing.js';
import { uploadStorage } from './tus-storage.js';
import { mediaDimensions } from './media-metadata';

export { isSupportedImageType, MAX_IMAGE_SIZE, prepareImage } from './image-processing.js';
export { mediaDimensions } from './media-metadata';

interface UploadMetadataApi {
	uploadMetadata(id: string, signal?: AbortSignal): Promise<NodoUpload | null>;
}

interface UploadMediaOptions {
	allowFiles?: boolean;
	/** Encrypt on this device; public profile images and callers with their own encryption pass false */
	encrypt?: boolean;
	maxFiles?: number;
	signal?: AbortSignal;
}

const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const maxVideoSize = 100 * 1024 * 1024;
const processingTimeoutMs = 5 * 60_000;
const processingPollIntervalMs = 1000;
const uploadIdPattern = /^[0-9a-f-]{36}$/i;

export async function uploadMedia(
	files: File[],
	nodoBaseUrl: string,
	api: UploadMetadataApi,
	onProgress: (percent: number) => void,
	options: UploadMediaOptions = {}
): Promise<string[]> {
	const signal = options.signal;
	signal?.throwIfAborted();
	if (files.length === 0) return [];

	const maxFiles = options.maxFiles ?? 4;
	validateFileCount(files, maxFiles);
	const encrypt = options.encrypt ?? true;
	validateOriginalFileSizes(files, encrypt);

	// Process images sequentially so decoded bitmaps do not accumulate in memory
	const preparedFiles = await prepareFiles(files, signal);
	signal?.throwIfAborted();
	validatePreparedFiles(preparedFiles, options.allowFiles ?? false);

	const encrypted: Awaited<ReturnType<typeof encryptMedia>>[] = [];
	if (encrypt)
		for (const file of preparedFiles) {
			signal?.throwIfAborted();
			const dimensions =
				isSupportedImageType(file.type) || videoTypes.has(file.type)
					? await mediaDimensions(file, signal)
					: { width: 0, height: 0 };
			encrypted.push(await encryptMedia(file, dimensions));
		}
	signal?.throwIfAborted();
	const transferFiles = encrypt ? encrypted.map((item) => item.file) : preparedFiles;
	validatePreparedFileSizes(transferFiles);
	const uppy = createUploader(nodoBaseUrl, maxFiles, onProgress);
	const abortUpload = () => uppy.cancelAll();
	signal?.addEventListener('abort', abortUpload, { once: true });
	try {
		addFilesToUploader(uppy, transferFiles);
		const result = await uppy.upload();
		signal?.throwIfAborted();
		const ids = getUploadIds(result, preparedFiles.length, nodoBaseUrl);
		await waitForProcessing(ids, api, signal);
		encrypted.forEach((item, index) => rememberMedia({ id: ids[index], ...item.descriptor }));
		return ids;
	} finally {
		signal?.removeEventListener('abort', abortUpload);
		uppy.destroy();
	}
}

function validateFileCount(files: File[], maxFiles: number): void {
	if (files.length > maxFiles) throw new Error(`Add at most ${maxFiles} files.`);
}

function validateOriginalFileSizes(files: File[], encrypt: boolean): void {
	// Device encryption adds a header, nonce and authentication tag.
	if (files.some((file) => file.size > maxVideoSize - (encrypt ? 36 : 0))) {
		throw new Error('A file exceeds the 100 MiB upload limit.');
	}
}

async function prepareFiles(files: File[], signal?: AbortSignal): Promise<File[]> {
	const preparedFiles: File[] = [];
	for (const file of files) {
		signal?.throwIfAborted();
		preparedFiles.push(await prepareImage(file));
	}
	return preparedFiles;
}

function validatePreparedFiles(files: File[], allowFiles: boolean): void {
	for (const file of files) {
		validateFileType(file, allowFiles);
		validatePreparedFileSize(file);
	}
}

function validateFileType(file: File, allowFiles: boolean): void {
	if (isSupportedImageType(file.type) || videoTypes.has(file.type) || allowFiles) return;
	throw new Error('Choose JPEG, PNG, WebP, MP4, WebM or MOV files.');
}

function validatePreparedFileSize(file: File): void {
	const sizeLimit = isSupportedImageType(file.type) ? MAX_IMAGE_SIZE : maxVideoSize;
	if (file.size < 1 || file.size > sizeLimit) {
		throw new Error(`${file.name} exceeds its upload limit.`);
	}
}

function validatePreparedFileSizes(files: File[]): void {
	for (const file of files) validatePreparedFileSize(file);
}

function createUploader(
	nodoBaseUrl: string,
	maxFiles: number,
	onProgress: (percent: number) => void
) {
	const uppy = new Uppy({
		autoProceed: false,
		restrictions: { maxNumberOfFiles: maxFiles, maxFileSize: maxVideoSize }
	});

	uppy.use(Tus, {
		endpoint: `${nodoBaseUrl.replace(/\/$/, '')}/v1/uploads/`,
		urlStorage: uploadStorage(nodoBaseUrl),
		retryDelays: [0, 1000, 3000, 5000],
		onBeforeRequest: async (request) => {
			request.setHeader('Authorization', `Bearer ${await accessToken()}`);
		}
	});
	uppy.on('progress', onProgress);

	return uppy;
}

function addFilesToUploader(uppy: ReturnType<typeof createUploader>, files: File[]): void {
	for (const file of files) {
		const filetype = getUploadMimeType(file.type);
		uppy.addFile({
			name: file.name,
			type: filetype,
			data: file,
			meta: { filetype, filename: file.name }
		});
	}
}

function getUploadMimeType(type: string): string {
	return isSupportedImageType(type) || videoTypes.has(type) ? type : 'application/octet-stream';
}

function getUploadIds(
	result: { failed?: unknown[]; successful?: Array<{ uploadURL?: string }> } | undefined,
	expectedCount: number,
	baseUrl: string
): string[] {
	const successful = result?.successful;
	if (!successful || result?.failed?.length || successful.length !== expectedCount) {
		throw new Error('One or more files could not be uploaded.');
	}

	return successful.map(({ uploadURL }) => getUploadId(uploadURL, baseUrl));
}

function getUploadId(uploadUrl: string | undefined, baseUrl: string): string {
	const pathname = uploadUrl ? new URL(uploadUrl, baseUrl).pathname : undefined;
	const id = pathname?.split('/').pop();
	if (!id || !uploadIdPattern.test(id)) {
		throw new Error('Nodo returned an invalid upload location.');
	}

	return id;
}

async function waitForProcessing(
	ids: string[],
	api: UploadMetadataApi,
	signal?: AbortSignal
): Promise<void> {
	const deadline = Date.now() + processingTimeoutMs;
	for (const id of ids) await waitForUpload(id, api, deadline, signal);
}

async function waitForUpload(
	id: string,
	api: UploadMetadataApi,
	deadline: number,
	signal?: AbortSignal
): Promise<void> {
	while (true) {
		signal?.throwIfAborted();
		const metadata = await api.uploadMetadata(id, signal);
		signal?.throwIfAborted();
		if (metadata?.complete) return;
		if (Date.now() >= deadline) throw new Error('Media processing timed out.');
		await delay(processingPollIntervalMs, signal);
	}
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', cancel);
			resolve();
		}, milliseconds);
		function cancel() {
			clearTimeout(timer);
			signal?.removeEventListener('abort', cancel);
			reject(signal?.reason);
		}
		signal?.addEventListener('abort', cancel, { once: true });
	});
}
