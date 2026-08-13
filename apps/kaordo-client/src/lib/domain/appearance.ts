export const APP_SCALES = [1, 1.1, 1.2, 1.3, 1.4] as const;
export const TEXT_SCALE_MIN = 0.9;
export const TEXT_SCALE_MAX = 1.5;
export const TEXT_SCALE_STEP = 0.05;

export type AppScale = typeof APP_SCALES[number];
export type AppTheme = 'dark' | 'light';
export type TextScale = number;

export type AppearancePreferences = {
  scale: AppScale;
  textScale: TextScale;
  theme: AppTheme;
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  scale: 1,
  textScale: 1,
  theme: 'light',
};

export function isAppScale(value: unknown): value is AppScale {
  return APP_SCALES.some((scale) => scale === value);
}

export function normalizeTextScale(value: unknown): TextScale {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_APPEARANCE.textScale;
  const clamped = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, value));
  return Math.round(clamped / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
}
