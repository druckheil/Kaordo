import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';
import type { LigoUser } from '../domain/ligo';
import type { LigoLocalAttachment } from './LigoLocalStore';

const WRITE_CHUNK_BYTES = 4 * 1_048_576;

type ArchiveFile = {
  attachment: LigoLocalAttachment;
  dateLabel: string;
  key: string;
};
type ArchiveTarget = { fileName: string; key: string; needsWrite: boolean };

export interface LigoFileArchive {
  readonly available: boolean;
  open(ownerId: string, peer: LigoUser, attachments: readonly LigoLocalAttachment[]): Promise<void>;
}

export function createLigoFileArchive(): LigoFileArchive {
  return isTauri() ? new TauriLigoFileArchive() : UNAVAILABLE_LIGO_FILE_ARCHIVE;
}

export const UNAVAILABLE_LIGO_FILE_ARCHIVE: LigoFileArchive = {
  available: false,
  async open() { throw new Error('Local chat folders are available in the desktop app.'); },
};

class TauriLigoFileArchive implements LigoFileArchive {
  readonly available = true;

  async open(ownerId: string, peer: LigoUser, attachments: readonly LigoLocalAttachment[]): Promise<void> {
    const files = attachments.map(toArchiveFile);
    const targets = await tauriInvoke<ArchiveTarget[]>('ligo_prepare_chat_files', {
      conversationId: peer.id,
      entries: files.map(({ attachment, dateLabel, key }) => ({
        dateLabel,
        key,
        name: attachment.name,
        size: attachment.size,
      })),
      ownerId,
      peerUsername: peer.username,
    });
    const filesByKey = new Map(files.map((file) => [file.key, file]));
    for (const target of targets) {
      if (!target.needsWrite) continue;
      const file = filesByKey.get(target.key);
      if (!file) throw new Error('The local chat file plan is invalid.');
      await writeInChunks(ownerId, peer, target.fileName, file.attachment.blob);
    }
    await tauriInvoke('ligo_open_chat_files', {
      conversationId: peer.id,
      ownerId,
      peerUsername: peer.username,
    });
  }
}

function toArchiveFile(attachment: LigoLocalAttachment): ArchiveFile {
  return {
    attachment,
    dateLabel: new Date(attachment.createdAt).toISOString().replace(/[.:]/gu, '-').replace('T', '_'),
    key: `${attachment.messageId}:${attachment.id}`,
  };
}

async function writeInChunks(ownerId: string, peer: LigoUser, fileName: string, blob: Blob): Promise<void> {
  for (let offset = 0; offset < blob.size || offset === 0; offset += WRITE_CHUNK_BYTES) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + WRITE_CHUNK_BYTES).arrayBuffer());
    await tauriInvoke('ligo_write_chat_file_chunk', bytes, { headers: {
      'x-kaordo-conversation-id': encodeHeader(peer.id),
      'x-kaordo-file-name': encodeHeader(fileName),
      'x-kaordo-offset': String(offset),
      'x-kaordo-owner-id': encodeHeader(ownerId),
      'x-kaordo-peer-username': encodeHeader(peer.username),
    } });
  }
}

function encodeHeader(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
