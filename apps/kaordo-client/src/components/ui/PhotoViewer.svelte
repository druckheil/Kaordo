<script lang="ts">
  import PhotoSwipeLightbox from 'photoswipe/lightbox';
  import type PhotoSwipe from 'photoswipe';
  import { onDestroy, onMount } from 'svelte';
  import 'photoswipe/style.css';

  type Props = {
    alt?: string;
    height?: number;
    name: string;
    onClose: () => void;
    url: string;
    width?: number;
  };

  let { alt, height, name, onClose, url, width }: Props = $props();
  let lightbox: PhotoSwipeLightbox | null = null;
  let viewerElement: HTMLDivElement | null = null;
  let downloadToastElement: HTMLDivElement | null = null;
  let fullscreenButton: HTMLButtonElement | null = null;
  let fullscreenRoot: Element | null = null;
  let disposed = false;
  let closeHandled = false;
  let previousOverflow = '';
  let downloadRequest: Promise<void> | null = null;
  let downloadToastTimer: number | null = null;

  onMount(() => {
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const viewer = new PhotoSwipeLightbox({
      arrowKeys: true,
      bgOpacity: 0.94,
      clickToCloseNonZoomable: false,
      dataSource: [{
        alt: alt ?? name,
        height: positiveDimension(height) ? height : 1200,
        src: url,
        width: positiveDimension(width) ? width : 1800,
      }],
      escKey: true,
      initialZoomLevel: 'fit',
      mainClass: 'kaordo-photo-viewer',
      mouseMovePan: true,
      preload: [1, 1],
      pswpModule: () => import('photoswipe'),
      secondaryZoomLevel: 'fill',
      showHideAnimationType: 'fade',
      trapFocus: true,
      wheelToZoom: true,
    });

    viewer.on('uiRegister', () => {
      viewerElement = viewer.pswp?.element ?? null;
      viewer.pswp?.ui?.registerElement({
        appendTo: 'root',
        className: 'kaordo-photo-download-toast',
        name: 'downloadToast',
        onInit: (element) => {
          downloadToastElement = element as HTMLDivElement;
          downloadToastElement.hidden = true;
          downloadToastElement.setAttribute('role', 'status');
          downloadToastElement.setAttribute('aria-live', 'polite');
        },
        order: 1,
        tagName: 'div',
      });
      viewer.pswp?.ui?.registerElement({
        ariaLabel: 'Download image',
        appendTo: 'bar',
        html: {
          inner: '<path d="M12 3v10m-4-4 4 4 4-4M5 17h14" />',
          isCustomSVG: true,
          size: 24,
        },
        isButton: true,
        name: 'download',
        onClick: () => downloadImage(),
        order: 8,
        title: 'Download image',
      });
      viewer.pswp?.ui?.registerElement({
        ariaLabel: 'Toggle fullscreen',
        appendTo: 'bar',
        html: {
          inner: '<path d="M5 8V5h3M16 5h3v3M19 13v3h-3M8 16H5v-3" />',
          isCustomSVG: true,
          size: 24,
        },
        isButton: true,
        name: 'fullscreen',
        onClick: (_event, element, pswp) => {
          fullscreenButton = element as HTMLButtonElement;
          fullscreenRoot = pswp.element ?? null;
          void toggleFullscreen(pswp);
        },
        onInit: (element) => {
          fullscreenButton = element as HTMLButtonElement;
          updateFullscreenButton();
        },
        order: 9,
        title: 'Enter fullscreen',
      });
    });
    viewer.on('close', handleClose);
    lightbox = viewer;
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    viewer.init();
    viewer.loadAndOpen(0);

    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenButton);
    };
  });

  onDestroy(() => {
    disposed = true;
    document.documentElement.style.overflow = previousOverflow;
    if (document.fullscreenElement && document.fullscreenElement === fullscreenRoot) {
      void document.exitFullscreen?.();
    }
    const activeViewer = lightbox?.pswp;
    activeViewer?.close();
    // PhotoSwipe normally waits for its close animation. The Svelte owner is
    // already gone here, so remove the detached viewer synchronously instead
    // of leaving a stale overlay in the document during rapid navigation.
    activeViewer?.destroy();
    lightbox?.destroy();
    viewerElement?.remove();
    downloadToastElement = null;
    if (downloadToastTimer) window.clearTimeout(downloadToastTimer);
    lightbox = null;
  });

  function handleClose(): void {
    if (disposed || closeHandled) return;
    closeHandled = true;
    onClose();
  }

  async function toggleFullscreen(pswp: PhotoSwipe): Promise<void> {
    try {
      fullscreenRoot = pswp.element ?? null;
      if (document.fullscreenElement === fullscreenRoot) {
        await document.exitFullscreen();
      } else if (fullscreenRoot?.requestFullscreen) {
        await fullscreenRoot.requestFullscreen();
      }
    } catch {
      // Fullscreen is optional in embedded WebViews and may be rejected by
      // the platform. The PhotoSwipe viewer itself remains fully usable.
    }
    updateFullscreenButton();
  }

  function updateFullscreenButton(): void {
    if (!fullscreenButton) return;
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenButton.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
  }

  function downloadImage(): void {
    if (downloadRequest) return;
    showDownloadMessage('Preparing download…');
    downloadRequest = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
        const blobUrl = URL.createObjectURL(await response.blob());
        try {
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = name;
          link.rel = 'noopener';
          link.style.display = 'none';
          document.body.append(link);
          link.click();
          link.remove();
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        }
        showDownloadMessage('Added to Downloads');
      })
      .catch(() => {
        showDownloadMessage('Download failed · Try again');
      })
      .finally(() => {
        downloadRequest = null;
      });
  }

  function showDownloadMessage(message: string): void {
    const toast = downloadToastElement;
    if (!toast) return;
    if (downloadToastTimer) window.clearTimeout(downloadToastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove('kaordo-photo-download-toast--visible');
    // Restart the entrance animation when the user downloads again quickly.
    void toast.offsetWidth;
    toast.classList.add('kaordo-photo-download-toast--visible');
    downloadToastTimer = window.setTimeout(() => {
      toast.classList.remove('kaordo-photo-download-toast--visible');
      toast.hidden = true;
      downloadToastTimer = null;
    }, 2200);
  }

  function positiveDimension(value: number | undefined): value is number {
    return value !== undefined && Number.isFinite(value) && value > 0;
  }
</script>

<style>
  :global(.kaordo-photo-viewer .pswp__bg) {
    background: rgb(5 9 8 / 94%);
  }

  :global(.kaordo-photo-viewer .pswp__img) {
    user-select: none;
  }

  :global(.kaordo-photo-viewer .pswp__button) {
    opacity: 0.9;
    transition: opacity 140ms ease, background 140ms ease;
  }

  :global(.kaordo-photo-viewer .pswp__button:hover) {
    opacity: 1;
    background: rgb(255 255 255 / 12%);
  }

  :global(.kaordo-photo-download-toast) {
    position: absolute;
    z-index: 1200;
    bottom: 26px;
    left: 50%;
    max-width: min(320px, calc(100vw - 44px));
    padding: 10px 14px;
    color: #f5fbf8;
    background: rgb(25 43 36 / 94%);
    border: 1px solid rgb(154 211 188 / 38%);
    border-radius: 10px;
    box-shadow: 0 12px 30px rgb(0 0 0 / 28%);
    font-size: calc(12px * var(--text-scale));
    font-weight: 650;
    pointer-events: none;
    opacity: 0;
    transform: translate(-50%, 8px);
    transition: opacity 160ms ease, transform 160ms ease;
    backdrop-filter: blur(12px);
  }

  :global(.kaordo-photo-download-toast--visible) {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.kaordo-photo-viewer .pswp__button) { transition: none; }
    :global(.kaordo-photo-download-toast) { transition: none; }
  }
</style>
