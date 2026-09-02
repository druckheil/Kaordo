import { canvasMediaKind } from './canvasMedia';

export type CanvasMediaDimensions = { height: number; width: number };

/** Reads intrinsic dimensions without keeping an object URL alive. */
export function readCanvasMediaDimensions(
  file: File,
): Promise<CanvasMediaDimensions | undefined> {
  const kind = canvasMediaKind(file);
  if (!kind || kind === 'audio') return Promise.resolve(undefined);

  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const cleanup = () => URL.revokeObjectURL(url);
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 1200);

    if (kind === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        const dimensions = video.videoWidth > 0 && video.videoHeight > 0
          ? { height: video.videoHeight, width: video.videoWidth }
          : undefined;
        cleanup();
        resolve(dimensions);
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        cleanup();
        resolve(undefined);
      };
      video.src = url;
      return;
    }

    const image = new Image();
    image.onload = () => {
      window.clearTimeout(timeout);
      const dimensions = image.naturalWidth > 0 && image.naturalHeight > 0
        ? { height: image.naturalHeight, width: image.naturalWidth }
        : undefined;
      cleanup();
      resolve(dimensions);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(undefined);
    };
    image.src = url;
  });
}
