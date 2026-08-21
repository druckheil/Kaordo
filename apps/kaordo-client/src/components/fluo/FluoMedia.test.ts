import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { FluoGState } from '../../lib/states/FluoGState';
import FluoMedia from './FluoMedia.svelte';

describe('FluoMedia', () => {
  it('sets a bounded intrinsic-width box instead of stretching a portrait media shell', () => {
    const register = vi.fn(() => () => undefined);
    const fluoState = {
      loadMedia: vi.fn(() => Promise.resolve(null)),
    } as unknown as FluoGState;
    const view = render(FluoMedia, {
      attachment: {
        height: 700,
        id: 'portrait',
        kind: 'image',
        mimeType: 'image/jpeg',
        name: 'portrait.jpg',
        size: 1,
        width: 400,
      },
      fluoState,
      postId: 'post-1',
      register,
    });

    const figure = view.container.querySelector('figure');
    expect(figure).not.toBeNull();
    expect(figure?.style.width).toBe('246px');
    expect(figure?.style.getPropertyValue('--media-ratio')).toBe(String(400 / 700));
    view.unmount();
  });
});
