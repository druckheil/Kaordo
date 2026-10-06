// Defines shared media types, frame sizing and gallery layout rules
export interface MediaAttachment {
  id: string;
  kind: 'image' | 'video';
  mimeType: string;
  width: number;
  height: number;
  size: number;
  altText: string;
  url: string;
}

export const minMediaRatio = 0.5;
export const maxMediaRatio = 2;
export const maxMediaHeightRem = 34;
export const mediaGapPx = 8;

export function mediaFrameRatio(item: Pick<MediaAttachment, 'width' | 'height'>): number {
  const naturalRatio = item.width / item.height;
  if (!Number.isFinite(naturalRatio) || naturalRatio <= 0) return 1;

  return Math.min(maxMediaRatio, Math.max(minMediaRatio, naturalRatio));
}

// Derive the carousel frame from neighboring media instead of a fixed preview width
export function mediaCarouselViewportRatio(ratios: readonly number[]): number {
  if (ratios.length < 2) return Math.max(1, ...ratios);

  let adjacentPairRatioTotal = 0;
  let widestAdjacentPairRatio = 0;

  for (let index = 0; index < ratios.length - 1; index += 1) {
    const adjacentPairRatio = (ratios[index] ?? 1) + (ratios[index + 1] ?? 1);
    adjacentPairRatioTotal += adjacentPairRatio;
    widestAdjacentPairRatio = Math.max(widestAdjacentPairRatio, adjacentPairRatio);
  }

  const averageAdjacentPairRatio = adjacentPairRatioTotal / (ratios.length - 1);
  const widestMediaRatio = Math.max(1, ...ratios);

  // Keep an unusually wide attachment and its neighbor in the same viewport
  return averageAdjacentPairRatio > widestMediaRatio ? averageAdjacentPairRatio : widestAdjacentPairRatio;
}

export function mediaFrameHeightPx(
  media: readonly Pick<MediaAttachment, 'width' | 'height'>[],
  availableWidth: number,
  remPx = 16
): number {
  if (!media.length || availableWidth <= 0) return 0;

  const ratios = media.map(mediaFrameRatio);
  const maxHeight = maxMediaHeightRem * remPx;
  if (ratios.length === 1) return singleMediaHeight(ratios[0], availableWidth, maxHeight);

  return mediaStripHeight(ratios, availableWidth, maxHeight);
}

export function mediaStripMaxWidth(ratios: readonly number[]): string {
  const mediaWidthRem = maxMediaHeightRem * ratios.reduce((sum, ratio) => sum + ratio, 0);
  const gapWidthPx = Math.max(0, ratios.length - 1) * mediaGapPx;

  return `calc(${mediaWidthRem}rem + ${gapWidthPx}px)`;
}

export function mediaPositionLabel(visibleIndexes: readonly number[], total: number): string {
  const firstVisible = visibleIndexes[0] ?? 0;
  const lastVisible = visibleIndexes[visibleIndexes.length - 1] ?? firstVisible;

  if (visibleIndexes.length > 1) return `${firstVisible + 1}–${lastVisible + 1} / ${total}`;
  return `${firstVisible + 1} / ${total}`;
}

export function mediaGridColumns(count: number): string {
  switch (count) {
    case 1:
      return 'grid-cols-1';
    case 3:
      return 'grid-cols-2 sm:grid-cols-3';
    case 2:
    case 4:
      return 'grid-cols-2';
    default:
      return 'grid-cols-2 sm:grid-cols-4';
  }
}

function singleMediaHeight(ratio: number, availableWidth: number, maxHeight: number): number {
  return Math.min(availableWidth, maxHeight * ratio) / ratio;
}

function mediaStripHeight(ratios: readonly number[], availableWidth: number, maxHeight: number): number {
  const stripWidth = maxHeight * ratios.reduce((sum, ratio) => sum + ratio, 0);
  const totalGapWidth = mediaGapPx * (ratios.length - 1);
  const widestFrameRatio = Math.max(1, ...ratios);
  const availableStripWidth = Math.min(availableWidth, stripWidth + totalGapWidth);

  return Math.min(maxHeight, availableStripWidth / widestFrameRatio);
}
