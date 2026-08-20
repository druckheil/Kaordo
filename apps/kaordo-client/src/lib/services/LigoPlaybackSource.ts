import { convertFileSrc, invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';
import type { LigoAttachment } from '../domain/ligo';

const WRITE_CHUNK_BYTES = 4 * 1_048_576;
const preparing = new Map<string, Promise<PreparedSource>>();

type PlaybackTarget = {
  fileName: string;
  needsWrite: boolean;
  path: string;
};
type PreparedSource = { url: string };

export type LigoPlaybackSource = { url: string; release(): void };

export function createLigoPlaybackSource(attachment: LigoAttachment): Promise<LigoPlaybackSource> {
  if (!isTauri()) return Promise.resolve(blobPlaybackSource(attachment));
  const key = `${attachment.id}:${attachment.size}`;
  let pending = preparing.get(key);
  if (!pending) {
    pending = prepareNativeSource(attachment).finally(() => { preparing.delete(key); });
    preparing.set(key, pending);
  }
  return pending.then((source) => ({ ...source, release() {} }));
}

async function prepareNativeSource(attachment: LigoAttachment): Promise<PreparedSource> {
  const target = await tauriInvoke<PlaybackTarget>('ligo_prepare_playback_file', {
    attachmentId: attachment.id,
    mimeType: attachment.mimeType,
    name: attachment.name,
    size: attachment.size,
  });
  if (target.needsWrite) await writeNativeFile(target.fileName, attachment.blob);
  return {
    url: `${convertFileSrc(target.path)}?v=${encodeURIComponent(attachment.id)}-${attachment.size}`,
  };
}

async function writeNativeFile(fileName: string, blob: Blob): Promise<void> {
  for (let offset = 0; offset < blob.size; offset += WRITE_CHUNK_BYTES) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + WRITE_CHUNK_BYTES).arrayBuffer());
    await tauriInvoke('ligo_write_playback_file_chunk', bytes, { headers: {
      'x-kaordo-file-name': encodeHeader(fileName),
      'x-kaordo-offset': String(offset),
      'x-kaordo-total': String(blob.size),
    } });
  }
}

function blobPlaybackSource(attachment: LigoAttachment): LigoPlaybackSource {
  const mimeType = isQuickTimeVideo(attachment) ? 'video/mp4' : attachment.mimeType;
  const url = URL.createObjectURL(attachment.blob.slice(0, attachment.blob.size, mimeType));
  return { url, release: () => { URL.revokeObjectURL(url); } };
}

function isQuickTimeVideo(file: LigoAttachment): boolean {
  return file.mimeType.toLowerCase() === 'video/quicktime' || file.name.toLowerCase().endsWith('.mov');
}

function encodeHeader(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
