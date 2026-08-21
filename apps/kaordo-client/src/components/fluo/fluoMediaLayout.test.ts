import { describe, expect, it } from 'vitest';
import {
  FLUO_MAX_MEDIA_HEIGHT,
  FLUO_MAX_MEDIA_WIDTH,
  FLUO_MIN_MEDIA_HEIGHT,
  getFluoMediaLayout,
} from './fluoMediaLayout';

describe('getFluoMediaLayout', () => {
  it('keeps a portrait image narrow while respecting the height limit', () => {
    const layout = getFluoMediaLayout(400, 700);

    expect(layout.height).toBe(FLUO_MAX_MEDIA_HEIGHT);
    expect(layout.width).toBe(Math.round(layout.height * (400 / 700)));
    expect(layout.width).toBeLessThan(FLUO_MAX_MEDIA_WIDTH);
  });

  it('uses the source size for smaller landscape media', () => {
    const layout = getFluoMediaLayout(320, 180);

    expect(layout.width).toBe(320);
    expect(layout.height).toBe(180);
  });

  it('keeps the same ratio when a grid column narrows the box', () => {
    const layout = getFluoMediaLayout(1920, 1080, 300);

    expect(layout.width).toBe(300);
    expect(layout.height).toBe(Math.round(300 / (1920 / 1080)));
  });

  it('gives metadata-free media a stable bounded fallback', () => {
    const layout = getFluoMediaLayout();

    expect(layout.width).toBe(FLUO_MAX_MEDIA_WIDTH);
    expect(layout.height).toBeLessThanOrEqual(FLUO_MAX_MEDIA_HEIGHT);
    expect(layout.height).toBeGreaterThanOrEqual(FLUO_MIN_MEDIA_HEIGHT);
  });
});
