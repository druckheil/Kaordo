import type { LigoAttachment } from '../domain/ligo';

type CachedAttachmentUrl = {
  signature: string;
  url: string;
};

class LigoAttachmentUrls {
  readonly #urls = new Map<string, CachedAttachmentUrl>();

  get(attachment: LigoAttachment): string {
    const signature = attachmentSignature(attachment);
    const cached = this.#urls.get(attachment.id);
    if (cached?.signature === signature) return cached.url;

    // Nodo attachment IDs are immutable content IDs. Keep their object URLs
    // alive for the WebView session: revoking one while WebView2 reopens the
    // same IndexedDB Blob can invalidate the file backing for the next view.
    const url = URL.createObjectURL(attachment.blob);
    this.#urls.set(attachment.id, { signature, url });
    return url;
  }
}

function attachmentSignature(attachment: LigoAttachment): string {
  return `${attachment.id}:${attachment.size}:${attachment.mimeType}:${attachment.name}`;
}

export const ligoAttachmentUrls = new LigoAttachmentUrls();
