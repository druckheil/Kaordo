import { accessToken } from '@kaordo/auth';
import type { NodoUpload } from '@kaordo/contracts';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import pica from 'pica';

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const maxImageSize = 20 * 1024 * 1024;
const maxVideoSize = 100 * 1024 * 1024;

async function prepared(file: File): Promise<File> {
  if (!imageTypes.has(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 16_000_000) {
      throw new Error(`${file.name} has too many pixels.`);
    }
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= 2560 && bitmap.width * bitmap.height <= 16_000_000 && file.size <= maxImageSize) return file;
    const ratio = Math.min(1, 2560 / longest);
    const source = document.createElement('canvas');
    source.width = bitmap.width;
    source.height = bitmap.height;
    source.getContext('2d')!.drawImage(bitmap, 0, 0);
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(bitmap.width * ratio));
    target.height = Math.max(1, Math.round(bitmap.height * ratio));
    const scaler = pica();
    await scaler.resize(source, target);
    const blob = await scaler.toBlob(target, file.type, file.type === 'image/jpeg' ? 0.85 : undefined);
    return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

export async function uploadMedia(
  files: File[], nodoBaseUrl: string, api: { uploadMetadata(id: string): Promise<NodoUpload | null> },
  onProgress: (percent: number) => void, options: { allowFiles?: boolean; maxFiles?: number } = {}
): Promise<string[]> {
  if (files.length === 0) return [];
  const maxFiles = options.maxFiles ?? 4;
  if (files.length > maxFiles) throw new Error(`Add at most ${maxFiles} files.`);
  if (files.some((file) => file.size > maxVideoSize)) throw new Error('A file exceeds the 100 MiB upload limit.');
  // Decoding and resizing several large images at once can retain multiple
  // bitmaps and canvases in memory. Keep preprocessing bounded to one image.
  const chosen: File[] = [];
  for (const file of files) chosen.push(await prepared(file));
  for (const file of chosen) {
    if (!imageTypes.has(file.type) && !videoTypes.has(file.type) && !options.allowFiles) {
      throw new Error('Choose JPEG, PNG, WebP, MP4, WebM or MOV files.');
    }
    if (file.size < 1 || file.size > (imageTypes.has(file.type) ? maxImageSize : maxVideoSize)) {
      throw new Error(`${file.name} exceeds its upload limit.`);
    }
  }

  const uppy = new Uppy({ autoProceed: false, restrictions: { maxNumberOfFiles: maxFiles, maxFileSize: maxVideoSize } });
  uppy.use(Tus, {
    endpoint: `${nodoBaseUrl.replace(/\/$/, '')}/v1/uploads/`,
    retryDelays: [0, 1000, 3000, 5000],
    onBeforeRequest: async (request) => request.setHeader('Authorization', `Bearer ${await accessToken()}`)
  });
  uppy.on('progress', onProgress);
  try {
    for (const file of chosen) {
      const filetype = imageTypes.has(file.type) || videoTypes.has(file.type) ? file.type : 'application/octet-stream';
      uppy.addFile({ name: file.name, type: filetype, data: file, meta: { filetype, filename: file.name } });
    }
    const result = await uppy.upload();
    if (!result || result.failed?.length || result.successful?.length !== chosen.length) {
      throw new Error('One or more files could not be uploaded.');
    }
    const ids = result.successful.map((file) => {
      const path = file.uploadURL && new URL(file.uploadURL, nodoBaseUrl).pathname;
      const id = path?.split('/').at(-1);
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Nodo returned an invalid upload location.');
      return id;
    });
    const deadline = Date.now() + 5 * 60_000;
    for (const id of ids) {
      while (true) {
        const metadata = await api.uploadMetadata(id);
        if (metadata?.complete) break;
        if (Date.now() >= deadline) throw new Error('Media processing timed out.');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    return ids;
  } finally {
    uppy.destroy();
  }
}
