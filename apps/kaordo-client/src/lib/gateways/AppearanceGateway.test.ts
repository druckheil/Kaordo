import { afterEach, describe, expect, it } from 'vitest';
import { WebAppearanceGateway } from './WebAppearanceGateway';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.scaleMode;
  document.documentElement.style.removeProperty('--app-scale');
  document.documentElement.style.removeProperty('--text-scale');
});

describe('appearance gateway', () => {
  it('persists valid global appearance settings', async () => {
    const storage = new MemoryStorage();
    const gateway = new WebAppearanceGateway(storage);

    expect(gateway.load()).toEqual({ scale: 1, textScale: 1, theme: 'light' });
    await gateway.save({ scale: 1.3, textScale: 1.25, theme: 'dark' });

    expect(new WebAppearanceGateway(storage).load()).toEqual({
      scale: 1.3,
      textScale: 1.25,
      theme: 'dark',
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe('1.3');
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.25');
  });

  it('ignores corrupt and unsupported saved values', () => {
    const storage = new MemoryStorage();
    storage.setItem('kaordo.appearance.v1', '{');
    expect(new WebAppearanceGateway(storage).load()).toEqual({ scale: 1, textScale: 1, theme: 'light' });
    storage.setItem('kaordo.appearance.v1', JSON.stringify({ scale: 9, theme: 'dark' }));
    expect(new WebAppearanceGateway(storage).load()).toEqual({ scale: 1, textScale: 1, theme: 'light' });
  });

  it('keeps existing appearance settings and adds the default text size', () => {
    const storage = new MemoryStorage();
    storage.setItem('kaordo.appearance.v1', JSON.stringify({ scale: 1.2, theme: 'dark' }));

    expect(new WebAppearanceGateway(storage).load()).toEqual({
      scale: 1.2,
      textScale: 1,
      theme: 'dark',
    });
  });

  it('moves pre-Kaordo appearance settings to the current key', () => {
    const storage = new MemoryStorage();
    const legacyKey = ['veri', 'dimensio.appearance.v1'].join('');
    storage.setItem(legacyKey, JSON.stringify({ scale: 1.2, textScale: 1.1, theme: 'dark' }));

    expect(new WebAppearanceGateway(storage).load()).toEqual({
      scale: 1.2,
      textScale: 1.1,
      theme: 'dark',
    });
    expect(storage.getItem('kaordo.appearance.v1')).not.toBeNull();
    expect(storage.getItem(legacyKey)).toBeNull();
  });
});

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length() { return this.#values.size; }
  clear() { this.#values.clear(); }
  getItem(key: string) { return this.#values.get(key) ?? null; }
  key(index: number) { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string) { this.#values.delete(key); }
  setItem(key: string, value: string) { this.#values.set(key, value); }
}
