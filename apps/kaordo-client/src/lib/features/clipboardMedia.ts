import { canvasMediaKind } from './canvasMedia';

/**
 * Returns the media files exposed by a paste event.
 *
 * Browsers usually expose an image copied from another application through
 * ClipboardItem#getAsFile(), while file-manager copies may only populate the
 * DataTransfer file list. Prefer the item list so the same clipboard payload
 * is not added twice, then keep only formats the canvas can render.
 */
export function clipboardMediaFiles(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];

  const itemFiles = Array.from(clipboard.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
    .map(normalizeClipboardFile);
  const candidates = itemFiles.length > 0
    ? itemFiles
    : Array.from(clipboard.files ?? []).map(normalizeClipboardFile);

  return candidates.filter((file) => canvasMediaKind(file) !== null);
}

function normalizeClipboardFile(file: File, index: number): File {
  if (file.name.trim()) return file;

  const mimeType = file.type.toLowerCase();
  const extension = mimeType === 'image/gif'
    ? 'gif'
    : mimeType.startsWith('image/')
      ? mimeType.slice('image/'.length).split('+', 1)[0] || 'png'
      : mimeType.startsWith('video/')
        ? mimeType.slice('video/'.length).split('+', 1)[0] || 'mp4'
        : mimeType.startsWith('audio/')
          ? mimeType.slice('audio/'.length).split('+', 1)[0] || 'mp3'
          : 'bin';

  try {
    return new File([file], `pasted-media-${Date.now()}-${index + 1}.${extension}`, {
      lastModified: file.lastModified,
      type: file.type,
    });
  } catch {
    return file;
  }
}
