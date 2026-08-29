import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { FluoGState } from '../../lib/states/FluoGState';
import FluoMedia from './FluoMedia.svelte';

describe('FluoMedia', () => {
  it('does not reuse a resolved source when a virtualized row receives another attachment', async () => {
    let load!: () => Promise<void>;
    const register = vi.fn((callback: () => Promise<void>) => {
      load = callback;
      return () => undefined;
    });
    const fluoState = {
      loadMedia: vi.fn(async (_postId: string, attachmentId: string) => `blob:${attachmentId}`),
    } as unknown as FluoGState;
    const first = {
      height: 300,
      id: 'first',
      kind: 'image' as const,
      mimeType: 'image/png',
      name: 'first.png',
      size: 1,
      width: 400,
    };
    const second = { ...first, id: 'second', name: 'second.png' };
    const view = render(FluoMedia, { attachment: first, fluoState, postId: 'post-1', register });

    await load();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:first');

    await view.rerender({ attachment: second, fluoState, postId: 'post-1', register });
    expect(view.container.querySelector('img')).toBeNull();
    await load();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:second');
  });

  it('renders the audio player for an audio attachment', async () => {
    localStorage.removeItem('kaordo.fluo.audio-volume');
    let load!: () => Promise<void>;
    const register = vi.fn((callback: () => Promise<void>) => {
      load = callback;
      return () => undefined;
    });
    const fluoState = {
      loadMedia: vi.fn(() => Promise.resolve('blob:audio')),
    } as unknown as FluoGState;
    const view = render(FluoMedia, {
      attachment: {
        id: 'audio-1',
        kind: 'audio',
        mimeType: 'audio/mpeg',
        name: 'lesson.mp3',
        size: 12,
      },
      fluoState,
      postId: 'post-1',
      register,
    });

    await load();

    expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('blob:audio');
    expect(view.container.querySelector('.audio-player__heading')?.textContent).toContain('lesson.mp3');
    expect((view.getByLabelText('Volume') as HTMLInputElement).value).toBe('1');
    expect(view.container.querySelector('img')).toBeNull();
    view.unmount();
    localStorage.removeItem('kaordo.fluo.audio-volume');
  });

  it('ignores a late response from the previous attachment', async () => {
    let resolveFirst!: (url: string) => void;
    let load!: () => Promise<void>;
    const register = vi.fn((callback: () => Promise<void>) => {
      load = callback;
      return () => undefined;
    });
    const fluoState = {
      loadMedia: vi.fn((_postId: string, attachmentId: string) => attachmentId === 'first'
        ? new Promise<string>((resolve) => { resolveFirst = resolve; })
        : Promise.resolve('blob:second')),
    } as unknown as FluoGState;
    const first = {
      height: 300,
      id: 'first',
      kind: 'image' as const,
      mimeType: 'image/png',
      name: 'first.png',
      size: 1,
      width: 400,
    };
    const second = { ...first, id: 'second', name: 'second.png' };
    const view = render(FluoMedia, { attachment: first, fluoState, postId: 'post-1', register });

    const firstRequest = load();
    await view.rerender({ attachment: second, fluoState, postId: 'post-1', register });
    await load();
    resolveFirst('blob:first');
    await firstRequest;

    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:second');
  });

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

  it('keeps the reserved media box when intrinsic dimensions arrive later', async () => {
    const register = vi.fn(() => () => undefined);
    const fluoState = {
      loadMedia: vi.fn(() => Promise.resolve(null)),
    } as unknown as FluoGState;
    const attachment = {
      id: 'legacy-media',
      kind: 'image' as const,
      mimeType: 'image/jpeg',
      name: 'legacy.jpg',
      size: 1,
    };
    const view = render(FluoMedia, {
      attachment,
      fluoState,
      postId: 'post-1',
      register,
    });
    const figure = view.container.querySelector('figure');
    expect(figure).not.toBeNull();
    const reservedWidth = figure?.style.width;
    const reservedHeight = figure?.style.height;

    await view.rerender({
      attachment: { ...attachment, height: 700, width: 400 },
      fluoState,
      postId: 'post-1',
      register,
    });

    expect(figure?.style.width).toBe(reservedWidth);
    expect(figure?.style.height).toBe(reservedHeight);
    view.unmount();
  });
});
