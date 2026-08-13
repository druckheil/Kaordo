import type {
  CanvasCamera,
  CanvasPoint,
  CanvasViewport,
} from '../domain/canvas';

export const CANVAS_WIDTH = 4800;
export const CANVAS_HEIGHT = 3200;
export const CANVAS_CARD_WIDTH = 360;
export const CANVAS_CARD_HEIGHT = 286;
export const CANVAS_CARD_MIN_WIDTH = 160;
export const CANVAS_CARD_MIN_HEIGHT = 120;
export const CANVAS_CARD_HEADER_HEIGHT = 48;
export const POINTER_DRAG_THRESHOLD = 6;
export const CANVAS_DEFAULT_ZOOM = 1;
export const CANVAS_MIN_ZOOM = 0.25;
export const CANVAS_MAX_ZOOM = 3;

const CANVAS_SIDE_PADDING = 40;
const CANVAS_TOP_PADDING = 72;

export function clampCanvasPoint(
  point: CanvasPoint,
  size = { height: CANVAS_CARD_HEIGHT, width: CANVAS_CARD_WIDTH },
): CanvasPoint {
  const constrained = constrainCanvasPoint(point, size);
  return {
    x: Math.round(constrained.x),
    y: Math.round(constrained.y),
  };
}

/** Keeps live pointer motion subpixel precise; persistence can round later. */
export function constrainCanvasPoint(
  point: CanvasPoint,
  size = { height: CANVAS_CARD_HEIGHT, width: CANVAS_CARD_WIDTH },
): CanvasPoint {
  return {
    x: clamp(
      point.x,
      CANVAS_SIDE_PADDING,
      CANVAS_WIDTH - size.width - CANVAS_SIDE_PADDING,
    ),
    y: clamp(
      point.y,
      CANVAS_TOP_PADDING,
      CANVAS_HEIGHT - size.height - CANVAS_SIDE_PADDING,
    ),
  };
}

export function pointerToCanvas(
  client: CanvasPoint,
  bounds: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>,
  viewport: Pick<CanvasViewport, 'scrollLeft' | 'scrollTop'>,
  grabOffset: CanvasPoint,
  size = { height: CANVAS_CARD_HEIGHT, width: CANVAS_CARD_WIDTH },
  zoom = CANVAS_DEFAULT_ZOOM,
): CanvasPoint | null {
  const isInside =
    client.x >= bounds.left &&
    client.x <= bounds.right &&
    client.y >= bounds.top &&
    client.y <= bounds.bottom;
  if (!isInside) return null;

  return constrainCanvasPoint(
    {
      x: (client.x - bounds.left + viewport.scrollLeft - grabOffset.x) / zoom,
      y: (client.y - bounds.top + viewport.scrollTop - grabOffset.y) / zoom,
    },
    size,
  );
}

export function clampCanvasZoom(zoom: number): number {
  return Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, zoom));
}

export function automaticPlacement(
  viewport: CanvasViewport,
  placementIndex: number,
  size = { height: CANVAS_CARD_HEIGHT, width: CANVAS_CARD_WIDTH },
): CanvasPoint {
  const radius = placementIndex === 0 ? 0 : 54 * Math.sqrt(placementIndex);
  const angle = placementIndex * Math.PI * (3 - Math.sqrt(5));

  return clampCanvasPoint(
    {
      x:
        viewport.scrollLeft +
        viewport.width / 2 -
        size.width / 2 +
        Math.cos(angle) * radius,
      y:
        viewport.scrollTop +
        viewport.height / 2 -
        size.height / 2 +
        Math.sin(angle) * radius,
    },
    size,
  );
}

export function cameraScroll(
  camera: CanvasCamera | undefined,
  viewport: Pick<CanvasViewport, 'height' | 'width'>,
): CanvasPoint {
  const center = camera ?? {
    centerX: CANVAS_WIDTH / 2,
    centerY: CANVAS_HEIGHT / 2,
  };

  return {
    x: clampCameraOffset(
      center.centerX - viewport.width / 2,
      CANVAS_WIDTH,
      viewport.width,
    ),
    y: clampCameraOffset(
      center.centerY - viewport.height / 2,
      CANVAS_HEIGHT,
      viewport.height,
    ),
  };
}

export function cameraFromScroll(
  scroll: CanvasPoint,
  viewport: Pick<CanvasViewport, 'height' | 'width'>,
): CanvasCamera {
  return {
    centerX: scroll.x + viewport.width / 2,
    centerY: scroll.y + viewport.height / 2,
  };
}

export function moveCanvasPoint(
  point: CanvasPoint,
  key: string,
  step: number,
  size = { height: CANVAS_CARD_HEIGHT, width: CANVAS_CARD_WIDTH },
): CanvasPoint | null {
  if (key === 'ArrowLeft') return clampCanvasPoint({ x: point.x - step, y: point.y }, size);
  if (key === 'ArrowRight') return clampCanvasPoint({ x: point.x + step, y: point.y }, size);
  if (key === 'ArrowUp') return clampCanvasPoint({ x: point.x, y: point.y - step }, size);
  if (key === 'ArrowDown') return clampCanvasPoint({ x: point.x, y: point.y + step }, size);
  return null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampCameraOffset(
  value: number,
  canvasSize: number,
  viewportSize: number,
): number {
  return Math.max(0, Math.min(canvasSize - viewportSize, Math.round(value)));
}
