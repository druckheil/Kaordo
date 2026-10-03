// Validates image dimensions and resizes large uploads in the browser
import pica from 'pica';

export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maximumSourceDimension = 8192;
const maximumSourcePixels = 16_000_000;
const maximumOutputDimension = 2560;
const jpegQuality = 0.85;

export function isSupportedImageType(type: string): boolean {
  return supportedImageTypes.has(type);
}

export async function prepareImage(file: File): Promise<File> {
  if (!isSupportedImageType(file.type)) return file;

  const bitmap = await createImageBitmap(file);
  try {
    validateImageDimensions(bitmap, file.name);
    if (!needsResizing(file, bitmap)) return file;
    return await resizeImage(file, bitmap);
  } finally {
    bitmap.close();
  }
}

function validateImageDimensions(bitmap: ImageBitmap, fileName: string): void {
  const exceedsDimensionLimit = bitmap.width > maximumSourceDimension || bitmap.height > maximumSourceDimension;
  const exceedsPixelLimit = bitmap.width * bitmap.height > maximumSourcePixels;

  if (exceedsDimensionLimit || exceedsPixelLimit) {
    throw new Error(`${fileName} has too many pixels.`);
  }
}

function needsResizing(file: File, bitmap: ImageBitmap): boolean {
  const longestDimension = Math.max(bitmap.width, bitmap.height);
  return longestDimension > maximumOutputDimension || file.size > MAX_IMAGE_SIZE;
}

async function resizeImage(file: File, bitmap: ImageBitmap): Promise<File> {
  const scale = Math.min(1, maximumOutputDimension / Math.max(bitmap.width, bitmap.height));
  const outputWidth = Math.max(1, Math.round(bitmap.width * scale));
  const outputHeight = Math.max(1, Math.round(bitmap.height * scale));
  const source = createCanvas(bitmap.width, bitmap.height);
  const sourceContext = source.getContext('2d');

  if (!sourceContext) throw new Error(`Could not process ${file.name}.`);
  sourceContext.drawImage(bitmap, 0, 0);

  const target = createCanvas(outputWidth, outputHeight);
  const scaler = pica();
  await scaler.resize(source, target);

  const quality = file.type === 'image/jpeg' ? jpegQuality : undefined;
  const blob = await scaler.toBlob(target, file.type, quality);
  return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
