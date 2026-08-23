import type { CanvasMediaKind } from '../domain/workspace';

export const CANVAS_MEDIA_MIN_WIDTH = 120;
export const CANVAS_MEDIA_MIN_HEIGHT = 72;
export const CANVAS_MEDIA_MAX_WIDTH = 720;
export const CANVAS_MEDIA_MAX_HEIGHT = 560;
export const CANVAS_AUDIO_WIDTH = 360;
export const CANVAS_AUDIO_HEIGHT = 76;

export function canvasMediaKind(file: Pick<File, 'name' | 'type'>): CanvasMediaKind | null {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (mimeType === 'image/gif' || extension === 'gif') return 'gif';
  if (mimeType.startsWith('image/') || imageExtensions.has(extension)) return 'image';
  if (mimeType.startsWith('video/') || videoExtensions.has(extension)) return 'video';
  if (mimeType.startsWith('audio/') || audioExtensions.has(extension)) return 'audio';
  return null;
}

export function canvasMediaMimeType(
  file: Pick<File, 'name' | 'type'>,
  kind: CanvasMediaKind,
): string {
  if (file.type.trim()) return file.type.split(';', 1)[0]!.trim().toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const known = extensionMimeTypes[extension];
  return known ?? `${kind}/*`;
}

export function canvasMediaFrame(
  kind: CanvasMediaKind,
  width?: number,
  height?: number,
): { height: number; width: number } {
  if (kind === 'audio') {
    return { height: CANVAS_AUDIO_HEIGHT, width: CANVAS_AUDIO_WIDTH };
  }
  const sourceWidth = Number.isFinite(width) && (width ?? 0) > 0 ? width! : 640;
  const sourceHeight = Number.isFinite(height) && (height ?? 0) > 0 ? height! : 360;
  const scale = Math.min(
    CANVAS_MEDIA_MAX_WIDTH / sourceWidth,
    CANVAS_MEDIA_MAX_HEIGHT / sourceHeight,
    1,
  );
  return {
    height: Math.max(CANVAS_MEDIA_MIN_HEIGHT, Math.round(sourceHeight * scale)),
    width: Math.max(CANVAS_MEDIA_MIN_WIDTH, Math.round(sourceWidth * scale)),
  };
}

const imageExtensions = new Set([
  'avif', 'bmp', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp',
]);
const videoExtensions = new Set([
  '3gp', 'avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm',
]);
const audioExtensions = new Set([
  'aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba', 'wma',
]);
const extensionMimeTypes: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  gif: 'image/gif',
  m4a: 'audio/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  webm: 'video/webm',
  weba: 'audio/webm',
};
