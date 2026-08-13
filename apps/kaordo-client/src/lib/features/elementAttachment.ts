import type { CanvasPlacement } from '../domain/canvas';
import type {
  CanvasElement,
  RectangleElement,
  TextElement,
} from '../domain/workspace';
import { CANVAS_CARD_HEADER_HEIGHT, CANVAS_HEIGHT, CANVAS_WIDTH } from './canvas';

export function settleCanvasElement(
  element: CanvasElement,
  globalX: number,
  globalY: number,
  elements: CanvasElement[],
  placements: CanvasPlacement[],
): CanvasElement {
  const centerX = globalX + element.width / 2;
  const centerY = globalY + element.height / 2;

  if (element.type === 'text') {
    const rectangle = [...elements]
      .reverse()
      .filter((candidate): candidate is RectangleElement =>
        candidate.type === 'rectangle' && candidate.id !== element.id,
      )
      .find((candidate) => {
        const frame = globalFrame(candidate, placements);
        return frame !== null && pointInFrame(centerX, centerY, frame);
      });
    if (rectangle) {
      return attachTextToRectangle(
        element,
        rectangle,
        globalX,
        globalY,
        placements,
      );
    }
  }

  const tray = [...placements].reverse().find((candidate) =>
    centerX >= candidate.x &&
    centerX <= candidate.x + candidate.width &&
    centerY >= candidate.y + CANVAS_CARD_HEADER_HEIGHT &&
    centerY <= candidate.y + candidate.height
  );
  if (tray) return attachToObject(element, tray, globalX, globalY);
  return detachFromParents(element, globalX, globalY);
}

export function moveTextWithRectangle(
  text: TextElement,
  previous: RectangleElement,
  next: RectangleElement,
): TextElement {
  const moved: TextElement = {
    ...text,
    parentElementId: next.id,
    x: next.x + text.x - previous.x,
    y: next.y + text.y - previous.y,
  };
  if (next.parentObjectId) moved.parentObjectId = next.parentObjectId;
  else delete moved.parentObjectId;
  return moved;
}

function attachTextToRectangle(
  text: TextElement,
  rectangle: RectangleElement,
  globalX: number,
  globalY: number,
  placements: CanvasPlacement[],
): TextElement {
  const tray = rectangle.parentObjectId
    ? placements.find((placement) => placement.id === rectangle.parentObjectId)
    : undefined;
  const surfaceX = tray ? globalX - tray.x : globalX;
  const surfaceY = tray
    ? globalY - tray.y - CANVAS_CARD_HEADER_HEIGHT
    : globalY;
  const width = Math.min(text.width, Math.max(32, rectangle.width));
  const attached: TextElement = {
    ...text,
    parentElementId: rectangle.id,
    width,
    x: clamp(surfaceX, rectangle.x, rectangle.x + rectangle.width - width),
    y: clamp(
      surfaceY,
      rectangle.y,
      rectangle.y + rectangle.height - text.height,
    ),
  };
  if (rectangle.parentObjectId) {
    attached.parentObjectId = rectangle.parentObjectId;
  } else {
    delete attached.parentObjectId;
  }
  return attached;
}

function attachToObject(
  element: CanvasElement,
  tray: CanvasPlacement,
  globalX: number,
  globalY: number,
): CanvasElement {
  const width = element.type === 'text'
    ? Math.min(element.width, Math.max(100, tray.width - 20))
    : element.width;
  const attached = {
    ...element,
    parentObjectId: tray.id,
    width,
    x: clamp(globalX - tray.x, 0, tray.width - width),
    y: clamp(
      globalY - tray.y - CANVAS_CARD_HEADER_HEIGHT,
      0,
      tray.height - CANVAS_CARD_HEADER_HEIGHT - element.height,
    ),
  };
  if (attached.type === 'text') delete attached.parentElementId;
  return attached;
}

function detachFromParents(
  element: CanvasElement,
  globalX: number,
  globalY: number,
): CanvasElement {
  const detached = { ...element };
  delete detached.parentObjectId;
  if (detached.type === 'text') delete detached.parentElementId;
  return {
    ...detached,
    x: clamp(globalX, 0, CANVAS_WIDTH - element.width),
    y: clamp(globalY, 0, CANVAS_HEIGHT - element.height),
  };
}

function globalFrame(
  element: RectangleElement,
  placements: CanvasPlacement[],
) {
  if (!element.parentObjectId) {
    return {
      bottom: element.y + element.height,
      left: element.x,
      right: element.x + element.width,
      top: element.y,
    };
  }
  const tray = placements.find((placement) => placement.id === element.parentObjectId);
  if (!tray) return null;
  const left = tray.x + element.x;
  const top = tray.y + CANVAS_CARD_HEADER_HEIGHT + element.y;
  return {
    bottom: top + element.height,
    left,
    right: left + element.width,
    top,
  };
}

function pointInFrame(
  x: number,
  y: number,
  frame: { bottom: number; left: number; right: number; top: number },
): boolean {
  return x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}
