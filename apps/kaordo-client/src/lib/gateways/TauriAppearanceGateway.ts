import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { AppearancePreferences } from '../domain/appearance';
import type { AppearanceGateway } from './AppearanceGateway';
import { applyTextScale, applyTheme, WebAppearanceGateway } from './WebAppearanceGateway';

export class TauriAppearanceGateway implements AppearanceGateway {
  readonly #local: WebAppearanceGateway;

  constructor(local = new WebAppearanceGateway()) {
    this.#local = local;
  }

  load(): AppearancePreferences {
    return this.#local.load();
  }

  async save(preferences: AppearancePreferences): Promise<void> {
    applyTheme(preferences.theme);
    applyTextScale(preferences.textScale);
    document.documentElement.dataset.scaleMode = 'native';
    await getCurrentWebview().setZoom(preferences.scale);
    localStorage.setItem('kaordo.appearance.v1', JSON.stringify(preferences));
  }
}
