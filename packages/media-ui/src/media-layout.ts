export interface MediaAttachment {
  id: string; kind: 'image' | 'video'; mimeType: string; width: number; height: number; size: number; altText: string; url: string;
}

export const minMediaRatio = 0.5;
export const maxMediaRatio = 2;
export const maxMediaHeightRem = 34;
export const mediaGapPx = 8;

export function mediaFrameRatio(item: Pick<MediaAttachment, 'width' | 'height'>): number {
  const natural = item.width / item.height;
  return Number.isFinite(natural) && natural > 0
    ? Math.min(maxMediaRatio, Math.max(minMediaRatio, natural))
    : 1;
}

export function mediaFrameHeightPx(
  media: readonly Pick<MediaAttachment, 'width' | 'height'>[],
  availableWidth: number,
  remPx = 16
): number {
  if (!media.length || availableWidth <= 0) return 0;
  const ratios = media.map(mediaFrameRatio);
  const maxHeight = maxMediaHeightRem * remPx;
  if (ratios.length === 1) return Math.min(availableWidth, maxHeight * ratios[0]) / ratios[0];
  const stripWidth = maxHeight * ratios.reduce((sum, ratio) => sum + ratio, 0) + mediaGapPx * (ratios.length - 1);
  return Math.min(maxHeight, Math.min(availableWidth, stripWidth) / Math.max(1, ...ratios));
}
