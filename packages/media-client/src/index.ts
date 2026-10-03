// Prepares browser media and coordinates resumable Nodo uploads
import { accessToken } from '@kaordo/auth';
import type { NodoUpload } from '@kaordo/contracts';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import { isSupportedImageType, MAX_IMAGE_SIZE, prepareImage } from './image-processing.js';
import { uploadStorage } from './tus-storage.js';

interface UploadMetadataApi {
  uploadMetadata(id: string): Promise<NodoUpload | null>;
}

interface UploadMediaOptions {
  allowFiles?: boolean;
  maxFiles?: number;
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
  if (files.length === 0) return [];

  const maxFiles = options.maxFiles ?? 4;
  validateFileCount(files, maxFiles);
  validateOriginalFileSizes(files);

  // Process images sequentially so decoded bitmaps do not accumulate in memory
  const preparedFiles = await prepareFiles(files);
  validatePreparedFiles(preparedFiles, options.allowFiles ?? false);

  const uppy = createUploader(nodoBaseUrl, maxFiles, onProgress);
  try {
    addFilesToUploader(uppy, preparedFiles);
    const result = await uppy.upload();
    const ids = getUploadIds(result, preparedFiles.length, nodoBaseUrl);
    await waitForProcessing(ids, api);
    return ids;
  } finally {
    uppy.destroy();
  }
}

function validateFileCount(files: File[], maxFiles: number): void {
  if (files.length > maxFiles) throw new Error(`Add at most ${maxFiles} files.`);
}

function validateOriginalFileSizes(files: File[]): void {
  if (files.some((file) => file.size > maxVideoSize)) {
    throw new Error('A file exceeds the 100 MiB upload limit.');
  }
}

async function prepareFiles(files: File[]): Promise<File[]> {
  const preparedFiles: File[] = [];
  for (const file of files) preparedFiles.push(await prepareImage(file));
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
    uppy.addFile({ name: file.name, type: filetype, data: file, meta: { filetype, filename: file.name } });
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

async function waitForProcessing(ids: string[], api: UploadMetadataApi): Promise<void> {
  const deadline = Date.now() + processingTimeoutMs;
  for (const id of ids) await waitForUpload(id, api, deadline);
}

async function waitForUpload(id: string, api: UploadMetadataApi, deadline: number): Promise<void> {
  while (true) {
    const metadata = await api.uploadMetadata(id);
    if (metadata?.complete) return;
    if (Date.now() >= deadline) throw new Error('Media processing timed out.');
    await delay(processingPollIntervalMs);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
