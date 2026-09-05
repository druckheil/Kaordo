export type MediaPreferences = {
  microphoneId: string;
  microphoneVolume: number;
  speakerId: string;
  speakerVolume: number;
};

/** Settings applied to a Rondo screen-share video track. */
export type RondoPresentationPreferences = {
  fps: number;
  resolution: number;
};

export const DEFAULT_RONDO_PRESENTATION_PREFERENCES: RondoPresentationPreferences = {
  fps: 30,
  resolution: 1080,
};

export const DEFAULT_MEDIA_PREFERENCES: MediaPreferences = {
  microphoneId: '',
  microphoneVolume: 100,
  speakerId: '',
  speakerVolume: 100,
};

export function normalizeMediaPreferences(value: unknown): MediaPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_MEDIA_PREFERENCES };
  const candidate = value as Partial<MediaPreferences>;
  return {
    microphoneId: typeof candidate.microphoneId === 'string' ? candidate.microphoneId : '',
    microphoneVolume: level(candidate.microphoneVolume, 200, 100),
    speakerId: typeof candidate.speakerId === 'string' ? candidate.speakerId : '',
    speakerVolume: level(candidate.speakerVolume, 100, 100),
  };
}

export function normalizeRondoPresentationPreferences(value: unknown): RondoPresentationPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_RONDO_PRESENTATION_PREFERENCES };
  const candidate = value as Partial<RondoPresentationPreferences>;
  return {
    fps: closest(candidate.fps, [15, 24, 30, 60, 120], DEFAULT_RONDO_PRESENTATION_PREFERENCES.fps),
    resolution: closest(candidate.resolution, [720, 1080, 1440], DEFAULT_RONDO_PRESENTATION_PREFERENCES.resolution),
  };
}

function level(value: unknown, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(0, value)));
}

function closest(value: unknown, options: number[], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return options.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best,
  );
}
