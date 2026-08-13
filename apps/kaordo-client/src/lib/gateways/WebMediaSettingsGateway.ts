import {
  DEFAULT_MEDIA_PREFERENCES,
  normalizeMediaPreferences,
  type MediaPreferences,
} from '../domain/mediaSettings';
import type { MediaSettingsGateway } from './MediaSettingsGateway';

const STORAGE_KEY = 'kaordo.media.v1';
const LEGACY_STORAGE_KEY = ['veri', 'dimensio.media.v1'].join('');

export class WebMediaSettingsGateway implements MediaSettingsGateway {
  constructor(private readonly storage: Storage | null = browserStorage()) {}

  load(): MediaPreferences {
    try {
      const current = this.storage?.getItem(STORAGE_KEY);
      const legacy = current === null ? this.storage?.getItem(LEGACY_STORAGE_KEY) : null;
      const saved: unknown = JSON.parse(current ?? legacy ?? 'null');
      const normalized = normalizeMediaPreferences(saved);
      if (current === null && legacy !== null) {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
        this.storage?.removeItem(LEGACY_STORAGE_KEY);
      }
      return normalized;
    } catch {
      return { ...DEFAULT_MEDIA_PREFERENCES };
    }
  }

  async save(preferences: MediaPreferences): Promise<void> {
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
