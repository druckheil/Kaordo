import type { MediaPreferences } from '../domain/mediaSettings';

export interface MediaSettingsGateway {
  load(): MediaPreferences;
  save(preferences: MediaPreferences): Promise<void>;
}
