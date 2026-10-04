// Carries the selected appearance to hosted forms even when their origin differs
import { theme, userPrefersMode } from 'mode-watcher';
import { resolveTheme } from './index.js';
import preferences from './preferences.json' with { type: 'json' };

export function withIdentityAppearance(identityUrl: string): string {
  const url = new URL(identityUrl);
  url.searchParams.set(preferences.identityThemeParameter, resolveTheme(theme.current).id);
  url.searchParams.set(preferences.identityModeParameter, userPrefersMode.current);
  return url.href;
}
