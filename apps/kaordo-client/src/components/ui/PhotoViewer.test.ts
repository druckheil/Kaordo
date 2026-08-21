import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import PhotoViewer from './PhotoViewer.svelte';

describe('PhotoViewer', () => {
  it('opens the PhotoSwipe viewer with zoom, download, and fullscreen controls', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        addListener: vi.fn(),
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    const onClose = vi.fn();
    const view = render(PhotoViewer, {
      name: 'photo.jpg',
      onClose,
      url: 'blob:http://localhost/photo',
      width: 1200,
      height: 800,
    });

    await waitFor(() => expect(document.querySelector('.kaordo-photo-viewer')).not.toBeNull());
    expect(document.querySelector('.pswp__button--zoom')).not.toBeNull();
    expect(document.querySelector('.pswp__button--download')).not.toBeNull();
    expect(document.querySelector('.pswp__button--fullscreen')).not.toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => ({
      blob: async () => new Blob(['photo'], { type: 'image/jpeg' }),
      ok: true,
      status: 200,
    })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/download');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await fireEvent.click(document.querySelector('.pswp__button--download')!);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Added to Downloads'));
    expect(anchorClick).toHaveBeenCalled();

    view.unmount();
    await waitFor(() => expect(document.querySelector('.kaordo-photo-viewer')).toBeNull());
    anchorClick.mockRestore();
    vi.restoreAllMocks();
  });
});
