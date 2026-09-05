import type { CanvasPlacement } from '../domain/canvas';
import type {
  ArrowAttachment,
  CanvasElement,
  MediaElement,
  RectangleElement,
  TextElement,
} from '../domain/workspace';
import { CANVAS_CARD_HEADER_HEIGHT, CANVAS_HEIGHT, CANVAS_WIDTH } from './canvas';

export type ArrowMoveTarget = {
  elementIds?: ReadonlySet<string>;
  /** Multiple panels can be translated in one gesture. */
  objectIds?: ReadonlySet<string>;
  objectId?: string;
  /** Arrows rendered inside a moved object already move with its DOM frame. */
  excludeParentObjectId?: string;
  /** Arrows that are part of the moved hierarchy already receive the delta. */
  excludeElementIds?: ReadonlySet<string>;
};

/**
 * Translates the persisted geometry of arrows attached to a moved target.
 *
 * Attached endpoints are resolved from their target on render, but control
 * points are absolute within the arrow's coordinate space. Keeping the
 * control points (and endpoint fallbacks) in the same translated space avoids
 * bends being left behind while an attached element or panel moves.
 */
export function translateAttachedArrowGeometry(
  elements: CanvasElement[],
  target: ArrowMoveTarget,
  deltaX: number,
  deltaY: number,
): CanvasElement[] {
  if (
    (deltaX === 0 && deltaY === 0) ||
    (!target.objectId && !target.objectIds?.size && !target.elementIds?.size)
  ) {
    return elements;
  }

  let changed = false;
  const translated = elements.map((element) => {
    if (
      element.type !== 'arrow' ||
      (target.excludeParentObjectId &&
        element.parentObjectId === target.excludeParentObjectId)
      || (target.excludeElementIds && target.excludeElementIds.has(element.id))
    ) {
      return element;
    }
    const startAttached = attachmentMatchesMove(element.startAttachment, target);
    const endAttached = attachmentMatchesMove(element.endAttachment, target);
    if (!startAttached && !endAttached) return element;

    changed = true;
    return {
      ...element,
      ...(startAttached
        ? { startX: element.startX + deltaX, startY: element.startY + deltaY }
        : {}),
      ...(endAttached
        ? { endX: element.endX + deltaX, endY: element.endY + deltaY }
        : {}),
      controlPoints: element.controlPoints.map((point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      })),
    };
  });
  return changed ? translated : elements;
}

function attachmentMatchesMove(
  attachment: ArrowAttachment | undefined,
  target: ArrowMoveTarget,
): boolean {
  if (!attachment) return false;
  return Boolean(
    (target.objectId && attachment.objectId === target.objectId) ||
    (target.objectIds && attachment.objectId && target.objectIds.has(attachment.objectId)) ||
    (attachment.elementId && target.elementIds?.has(attachment.elementId)),
  );
}

export function settleCanvasElement(
  element: CanvasElement,
  globalX: number,
  globalY: number,
  elements: readonly CanvasElement[],
  placements: readonly CanvasPlacement[],
): CanvasElement {
  const centerX = globalX + element.width / 2;
  const centerY = globalY + element.height / 2;
  const placementsById = new Map(
    placements.map((placement) => [placement.id, placement] as const),
  );

  if (element.type === 'text' || element.type === 'media') {
    // Iterate backwards so the visually topmost rectangle wins, without
    // allocating a reversed/filter array for every drop.
    let rectangle: RectangleElement | undefined;
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const candidate = elements[index];
      if (!candidate || candidate.type !== 'rectangle' || candidate.id === element.id) continue;
      const frame = globalFrame(candidate, placementsById);
      if (frame && pointInFrame(centerX, centerY, frame)) {
        rectangle = candidate;
        break;
      }
    }
    if (rectangle) {
      return attachElementToRectangle(element, rectangle, globalX, globalY, placementsById);
    }
  }

  let tray: CanvasPlacement | undefined;
  for (let index = placements.length - 1; index >= 0; index -= 1) {
    const candidate = placements[index];
    if (
      candidate &&
      centerX >= candidate.x &&
      centerX <= candidate.x + candidate.width &&
      centerY >= candidate.y + CANVAS_CARD_HEADER_HEIGHT &&
      centerY <= candidate.y + candidate.height
    ) {
      tray = candidate;
      break;
    }
  }
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

export function moveMediaWithRectangle(
  media: MediaElement,
  previous: RectangleElement,
  next: RectangleElement,
): MediaElement {
  const moved: MediaElement = {
    ...media,
    parentElementId: next.id,
    x: next.x + media.x - previous.x,
    y: next.y + media.y - previous.y,
  };
  if (next.parentObjectId) moved.parentObjectId = next.parentObjectId;
  else delete moved.parentObjectId;
  return moved;
}

function attachElementToRectangle(
  element: TextElement | MediaElement,
  rectangle: RectangleElement,
  globalX: number,
  globalY: number,
  placements: ReadonlyMap<string, CanvasPlacement>,
): TextElement | MediaElement {
  const tray = rectangle.parentObjectId
    ? placements.get(rectangle.parentObjectId)
    : undefined;
  const surfaceX = tray ? globalX - tray.x : globalX;
  const surfaceY = tray
    ? globalY - tray.y - CANVAS_CARD_HEADER_HEIGHT
    : globalY;
  const width = Math.min(element.width, Math.max(32, rectangle.width));
  const attached = {
    ...element,
    parentElementId: rectangle.id,
    width,
    x: clamp(surfaceX, rectangle.x, rectangle.x + rectangle.width - width),
    y: clamp(
      surfaceY,
      rectangle.y,
      rectangle.y + rectangle.height - element.height,
    ),
  };
  if (rectangle.parentObjectId) {
    attached.parentObjectId = rectangle.parentObjectId;
  } else {
    delete attached.parentObjectId;
  }
  return attached as TextElement | MediaElement;
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
  if (attached.type === 'text' || attached.type === 'media') {
    delete attached.parentElementId;
  }
  return attached;
}

function detachFromParents(
  element: CanvasElement,
  globalX: number,
  globalY: number,
): CanvasElement {
  const detached = { ...element };
  delete detached.parentObjectId;
  if (detached.type === 'text' || detached.type === 'media') {
    delete detached.parentElementId;
  }
  return {
    ...detached,
    x: clamp(globalX, 0, CANVAS_WIDTH - element.width),
    y: clamp(globalY, 0, CANVAS_HEIGHT - element.height),
  };
}

function globalFrame(
  element: RectangleElement,
  placements: ReadonlyMap<string, CanvasPlacement>,
) {
  if (!element.parentObjectId) {
    return {
      bottom: element.y + element.height,
      left: element.x,
      right: element.x + element.width,
      top: element.y,
    };
  }
  const tray = placements.get(element.parentObjectId);
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
