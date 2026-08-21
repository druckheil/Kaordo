import type { AppearancePreferences } from '../domain/appearance';
import type { AppearanceGateway } from './AppearanceGateway';
import { WebAppearanceGateway } from './WebAppearanceGateway';

export class TauriAppearanceGateway implements AppearanceGateway {
  readonly #local: WebAppearanceGateway;

  constructor(local = new WebAppearanceGateway()) {
    this.#local = local;
  }

  load(): AppearancePreferences {
    return this.#local.load();
  }

  save(preferences: AppearancePreferences): Promise<void> {
    // WKWebView pageZoom discards the complete backing/tile cache. That made
    // Fluo randomly repaint blank regions after application-scale changes.
    // The CSS scale path keeps the same user-visible sizing without resetting
    // the native compositor or capping the scroll path behind an IPC call.
    return this.#local.save(preferences);
  }
}
