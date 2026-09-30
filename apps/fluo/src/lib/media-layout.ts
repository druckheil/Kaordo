import type { FluoMedia } from '@kaordo/contracts';

export const minMediaRatio = 0.5;
export const maxMediaRatio = 2;
export const maxMediaHeightRem = 34;

export function mediaFrameRatio(item: Pick<FluoMedia, 'width' | 'height'>): number {
  const natural = item.width / item.height;
  return Number.isFinite(natural) && natural > 0
    ? Math.min(maxMediaRatio, Math.max(minMediaRatio, natural))
    : 1;
}
