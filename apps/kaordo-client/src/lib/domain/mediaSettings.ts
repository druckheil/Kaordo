export type MediaPreferences = {
  microphoneId: string;
  microphoneVolume: number;
  speakerId: string;
  speakerVolume: number;
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

function level(value: unknown, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(0, value)));
}
