import type { DesegnDrawing } from '../domain/desegnLernado';

const MAX_DRAWING_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 12_000;
const THUMBNAIL_LONG_EDGE = 840;
const INITIAL_REVIEW_DELAY_MS = 3 * 86_400_000;
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i;
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type PreparedDesegnDrawing = {
  drawing: DesegnDrawing;
  original: Blob;
  thumbnail: Blob;
};

export function isDesegnImageFile(file: File): boolean {
  const mimeType = normalizedMimeType(file.type);
  return (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml')
    || (!mimeType && IMAGE_EXTENSION.test(file.name));
}

export async function prepareDesegnDrawing(file: File, now = Date.now()): Promise<PreparedDesegnDrawing> {
  const mimeType = validateDrawingFile(file);
  const sourceFile = normalizedMimeType(file.type) === mimeType
    ? file
    : new File([file], file.name, { type: mimeType });
  const source = await decodeImage(sourceFile);
  try {
    if (source.width > MAX_IMAGE_DIMENSION || source.height > MAX_IMAGE_DIMENSION
      || source.width * source.height > MAX_IMAGE_PIXELS) {
      throw new Error('This drawing is too large to preview safely. Use an image up to 12,000 px per side and 40 megapixels.');
    }
    const scale = Math.min(1, THUMBNAIL_LONG_EDGE / Math.max(source.width, source.height));
    const thumbnailWidth = Math.max(1, Math.round(source.width * scale));
    const thumbnailHeight = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = thumbnailWidth;
    canvas.height = thumbnailHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('This device could not prepare a drawing preview.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source.image, 0, 0, thumbnailWidth, thumbnailHeight);
    const thumbnail = await canvasBlob(canvas);
    const id = randomId();
    const title = drawingTitle(file.name);
    return {
      drawing: {
        byteSize: file.size,
        createdAt: now,
        description: '',
        fileName: file.name || `${title}.png`,
        focus: 'other',
        height: source.height,
        id,
        lastReviewedAt: null,
        mimeType,
        nextReviewAt: now + INITIAL_REVIEW_DELAY_MS,
        rating: null,
        reviewCount: 0,
        shortcomings: [],
        title,
        updatedAt: now,
        width: source.width,
      },
      original: file.slice(0, file.size, mimeType),
      thumbnail,
    };
  } finally {
    source.close();
  }
}

function validateDrawingFile(file: File): string {
  const mimeType = normalizedMimeType(file.type) || mimeTypeFromName(file.name);
  if (!mimeType.startsWith('image/')) {
    throw new Error(`${file.name || 'Clipboard item'} is not an image.`);
  }
  if (mimeType === 'image/svg+xml') {
    throw new Error('SVG drawings are not supported. Export the artwork as PNG, JPEG, or WebP first.');
  }
  if (file.size <= 0) throw new Error(`${file.name || 'This image'} is empty.`);
  if (file.size > MAX_DRAWING_BYTES) {
    throw new Error(`${file.name || 'This image'} is larger than 50 MB.`);
  }
  return mimeType;
}

function normalizedMimeType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function mimeTypeFromName(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? '';
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { close: () => bitmap.close(), height: bitmap.height, image: bitmap, width: bitmap.width };
      }
      bitmap.close();
    } catch {
      // WKWebView does not decode every camera format through ImageBitmap;
      // the native image element supports a few additional formats.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('The image has no visible pixels.');
    return {
      close: () => URL.revokeObjectURL(url),
      height: image.naturalHeight,
      image,
      width: image.naturalWidth,
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name || 'This image'} could not be decoded.`);
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      // Older embedded WebViews may decode WebP but not encode it. PNG keeps
      // the preview path functional without touching the original artwork.
      canvas.toBlob((fallback) => {
        if (fallback) resolve(fallback);
        else reject(new Error('This device could not prepare a drawing preview.'));
      }, 'image/png');
    }, 'image/webp', 0.84);
  });
}

function drawingTitle(fileName: string): string {
  const clean = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return (clean || 'Untitled drawing').slice(0, 100);
}

let fallbackId = 0;

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // This branch is only for old embedded WebViews without Web Crypto. The
  // monotonic suffix prevents collisions within a process without pretending
  // that Math.random is a security primitive.
  fallbackId += 1;
  return `drawing-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

type DecodedImage = {
  close: () => void;
  height: number;
  image: CanvasImageSource;
  width: number;
};
