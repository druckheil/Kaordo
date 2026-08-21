import { beforeEach, describe, expect, it } from 'vitest';
import type { AppearancePreferences } from '../domain/appearance';
import { TauriAppearanceGateway } from './TauriAppearanceGateway';

const preferences = (
  scale: AppearancePreferences['scale'],
  textScale: AppearancePreferences['textScale'] = 1,
): AppearancePreferences => ({ scale, textScale, theme: 'light' });

describe('TauriAppearanceGateway', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.scaleMode;
    document.documentElement.style.removeProperty('--app-scale');
    document.documentElement.style.removeProperty('--text-scale');
  });

  it('uses compositor-safe CSS scaling instead of native WebView page zoom', async () => {
    const gateway = new TauriAppearanceGateway();

    await gateway.save(preferences(1.3, 1.2));

    expect(document.documentElement.dataset.scaleMode).toBe('css');
    expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe('1.3');
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.2');
    expect(JSON.parse(localStorage.getItem('kaordo.appearance.v1') ?? 'null')).toEqual(
      preferences(1.3, 1.2),
    );
  });
});
