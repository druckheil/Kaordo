import type { AppearancePreferences } from '../domain/appearance';

export interface AppearanceGateway {
  load(): AppearancePreferences;
  save(preferences: AppearancePreferences): Promise<void>;
}
