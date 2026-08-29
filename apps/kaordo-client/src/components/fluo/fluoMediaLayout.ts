export const FLUO_MAX_MEDIA_HEIGHT = 430;
export const FLUO_MAX_MEDIA_WIDTH = 620;
export const FLUO_AUDIO_MEDIA_HEIGHT = 76;
/** Maximum width of one item in the multi-media carousel. */
export const FLUO_CAROUSEL_MEDIA_WIDTH = 320;

export type FluoMediaLayout = {
  height: number;
  ratio: number;
  width: number;
};

export type FluoMediaDimensions = {
  height: number;
  width: number;
};

/** Returns a compact, stable player box for audio attachments. */
export function getFluoAudioLayout(availableWidth = FLUO_MAX_MEDIA_WIDTH): FluoMediaLayout {
  const width = Math.max(1, Math.min(FLUO_MAX_MEDIA_WIDTH, availableWidth));
  return {
    height: FLUO_AUDIO_MEDIA_HEIGHT,
    ratio: width / FLUO_AUDIO_MEDIA_HEIGHT,
    width,
  };
}

/**
 * Calculates one stable display box from the media metadata.
 *
 * The original dimensions remain the primary input. The height and width
 * limits only keep extreme portraits and panoramas usable. There is no
 * artificial minimum height: small images keep their real size instead of
 * gaining an empty strip above or below the media.
 */
export function getFluoMediaLayout(
  width?: number,
  height?: number,
  availableWidth = FLUO_MAX_MEDIA_WIDTH,
): FluoMediaLayout {
  const ratio = normalizeFluoMediaRatio(width, height);
  const maxWidth = Math.max(1, Math.min(FLUO_MAX_MEDIA_WIDTH, availableWidth));
  const maxByHeight = FLUO_MAX_MEDIA_HEIGHT * ratio;
  const upperWidth = Math.max(1, Math.min(maxWidth, maxByHeight));
  const sourceWidth = positiveFinite(width) ? width : upperWidth;
  const displayWidth = clamp(sourceWidth, 1, upperWidth);
  const displayHeight = displayWidth / ratio;

  return {
    height: Math.max(1, Math.round(displayHeight)),
    ratio,
    width: Math.max(1, Math.round(displayWidth)),
  };
}

export function normalizeFluoMediaRatio(width?: number, height?: number): number {
  if (!positiveFinite(width) || !positiveFinite(height)) return 16 / 9;
  return clamp(width / height, 0.35, 4);
}

function positiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
