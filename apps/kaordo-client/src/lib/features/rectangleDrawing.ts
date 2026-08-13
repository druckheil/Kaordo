import type { CanvasPoint } from '../domain/canvas';

export const RECTANGLE_DRAW_MIN_HEIGHT = 28;
export const RECTANGLE_DRAW_MIN_WIDTH = 32;

const RECTANGLE_DRAG_THRESHOLD = 4;

export type RectangleDrawGesture = {
  currentX: number;
  currentY: number;
  dragged: boolean;
  kind: 'draw';
  pointerId: number;
  startX: number;
  startY: number;
};

type RectangleGeometry = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type RectangleGeometryOptions = {
  boundsHeight: number;
  boundsWidth: number;
  clickHeight: number;
  clickWidth: number;
};

export function startRectangleDraw(
  point: CanvasPoint,
  pointerId: number,
): RectangleDrawGesture {
  return {
    currentX: point.x,
    currentY: point.y,
    dragged: false,
    kind: 'draw',
    pointerId,
    startX: point.x,
    startY: point.y,
  };
}

export function continueRectangleDraw(
  draw: RectangleDrawGesture,
  point: CanvasPoint,
): RectangleDrawGesture {
  const distance = Math.hypot(point.x - draw.startX, point.y - draw.startY);
  return {
    ...draw,
    currentX: point.x,
    currentY: point.y,
    dragged: draw.dragged || distance >= RECTANGLE_DRAG_THRESHOLD,
  };
}

export function rectangleGeometry(
  draw: RectangleDrawGesture,
  options: RectangleGeometryOptions,
): RectangleGeometry {
  if (draw.dragged) {
    return {
      height: Math.abs(draw.currentY - draw.startY),
      width: Math.abs(draw.currentX - draw.startX),
      x: Math.min(draw.startX, draw.currentX),
      y: Math.min(draw.startY, draw.currentY),
    };
  }

  return {
    height: options.clickHeight,
    width: options.clickWidth,
    x: clamp(
      draw.startX - options.clickWidth / 2,
      0,
      options.boundsWidth - options.clickWidth,
    ),
    y: clamp(
      draw.startY - options.clickHeight / 2,
      0,
      options.boundsHeight - options.clickHeight,
    ),
  };
}

export function isRectangleDrawValid(draw: RectangleDrawGesture): boolean {
  return !draw.dragged || (
    Math.abs(draw.currentX - draw.startX) >= RECTANGLE_DRAW_MIN_WIDTH &&
    Math.abs(draw.currentY - draw.startY) >= RECTANGLE_DRAW_MIN_HEIGHT
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}
