import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { FluoGState } from '../../lib/states/FluoGState';
import FluoMediaCarousel from './FluoMediaCarousel.svelte';

describe('FluoMediaCarousel', () => {
  it('renders multiple media as one horizontal, navigable track', () => {
    const view = render(FluoMediaCarousel, {
      attachments: [
        { id: 'one', kind: 'image', mimeType: 'image/jpeg', name: 'one.jpg', size: 1, width: 800, height: 600 },
        { id: 'two', kind: 'image', mimeType: 'image/jpeg', name: 'two.jpg', size: 1, width: 600, height: 800 },
      ],
      fluoState: {
        loadMedia: vi.fn(() => Promise.resolve(null)),
      } as unknown as FluoGState,
      postId: 'post-1',
      registerMedia: vi.fn(() => () => undefined),
    });

    expect(view.container.querySelectorAll('figure')).toHaveLength(2);
    expect(view.container.querySelector('.media-carousel-scroller')).not.toBeNull();
    expect(view.container.querySelector<HTMLButtonElement>('.carousel-nav--left')).toBeDisabled();
    expect(view.container.querySelector<HTMLButtonElement>('.carousel-nav--right')).toBeDisabled();
    view.unmount();
  });

  it('equalizes visual media to the tallest calculated item', () => {
    const view = render(FluoMediaCarousel, {
      attachments: [
        { id: 'short', kind: 'image', mimeType: 'image/jpeg', name: 'short.jpg', size: 1, width: 160, height: 90 },
        { id: 'tall', kind: 'image', mimeType: 'image/jpeg', name: 'tall.jpg', size: 1, width: 120, height: 240 },
      ],
      fluoState: {
        loadMedia: vi.fn(() => Promise.resolve(null)),
      } as unknown as FluoGState,
      postId: 'post-2',
      registerMedia: vi.fn(() => () => undefined),
    });

    const figures = [...view.container.querySelectorAll<HTMLElement>('figure')];
    expect(figures).toHaveLength(2);
    expect(figures.map((figure) => figure.style.getPropertyValue('--media-height'))).toEqual(['240px', '240px']);
    expect(figures[0]?.style.getPropertyValue('--media-width')).toBe('427px');
    expect(figures[1]?.style.getPropertyValue('--media-width')).toBe('120px');
    view.unmount();
  });
});
