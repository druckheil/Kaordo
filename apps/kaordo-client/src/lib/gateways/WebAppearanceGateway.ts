import {
  DEFAULT_APPEARANCE,
  isAppScale,
  normalizeTextScale,
  type AppearancePreferences,
  type AppTheme,
} from '../domain/appearance';
import type { AppearanceGateway } from './AppearanceGateway';

const STORAGE_KEY = 'kaordo.appearance.v1';
const LEGACY_STORAGE_KEY = ['veri', 'dimensio.appearance.v1'].join('');

export class WebAppearanceGateway implements AppearanceGateway {
  readonly #storage: Storage | null;

  constructor(storage: Storage | null = browserStorage()) {
    this.#storage = storage;
  }

  load(): AppearancePreferences {
    try {
      const current = this.#storage?.getItem(STORAGE_KEY);
      const legacy = current === null ? this.#storage?.getItem(LEGACY_STORAGE_KEY) : null;
      const value: unknown = JSON.parse(current ?? legacy ?? 'null');
      if (isAppearance(value)) {
        if (current === null && legacy !== null) {
          this.#storage?.setItem(STORAGE_KEY, JSON.stringify(value));
          this.#storage?.removeItem(LEGACY_STORAGE_KEY);
        }
        return { ...value, textScale: normalizeTextScale(value.textScale) };
      }
    } catch {
      // Corrupt or unavailable local settings fall back to safe defaults.
    }
    return { ...DEFAULT_APPEARANCE };
  }

  async save(preferences: AppearancePreferences): Promise<void> {
    applyTheme(preferences.theme);
    applyWebScale(preferences.scale);
    applyTextScale(preferences.textScale);
    this.#storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute('content', theme === 'dark' ? '#111815' : '#1d2825');
}

export function applyTextScale(scale: number): void {
  document.documentElement.style.setProperty('--text-scale', String(scale));
}

function applyWebScale(scale: number): void {
  document.documentElement.dataset.scaleMode = 'css';
  document.documentElement.style.setProperty('--app-scale', String(scale));
}

function isAppearance(value: unknown): value is Omit<AppearancePreferences, 'textScale'> & { textScale?: unknown } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppearancePreferences>;
  return (candidate.theme === 'dark' || candidate.theme === 'light')
    && isAppScale(candidate.scale);
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
