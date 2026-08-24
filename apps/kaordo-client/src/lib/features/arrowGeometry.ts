import type {
  ArrowAnchorSide,
  ArrowAttachment,
  ArrowElement,
  CanvasElement,
} from '../domain/workspace';
import type { CanvasPlacement } from '../domain/canvas';
import { CANVAS_CARD_HEADER_HEIGHT } from './canvas';

export type ArrowPoint = { x: number; y: number };

export type CanvasFrame = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export const ARROW_MIN_LENGTH = 12;
export const ARROW_SNAP_DISTANCE = 28;

export function arrowPoints(
  arrow: ArrowElement,
  elements: readonly CanvasElement[],
  placements: readonly CanvasPlacement[],
): { end: ArrowPoint; start: ArrowPoint } {
  return {
    end: resolvePoint(arrow, arrow.endAttachment, { x: arrow.endX, y: arrow.endY }, elements, placements),
    start: resolvePoint(arrow, arrow.startAttachment, { x: arrow.startX, y: arrow.startY }, elements, placements),
  };
}

export function arrowBounds(
  points: { controlPoints?: readonly ArrowPoint[]; end: ArrowPoint; start: ArrowPoint },
  padding = 14,
): CanvasFrame {
  const pathPoints = [points.start, ...(points.controlPoints ?? []), points.end];
  const boundsPoints = [...pathPoints];
  for (let index = 0; index < pathPoints.length - 1; index += 1) {
    const controls = cubicControls(
      pathPoints[index - 1] ?? pathPoints[index],
      pathPoints[index],
      pathPoints[index + 1],
      pathPoints[index + 2] ?? pathPoints[index + 1],
    );
    boundsPoints.push(controls.first, controls.second);
  }
  return {
    bottom: Math.max(...boundsPoints.map((point) => point.y)) + padding,
    left: Math.min(...boundsPoints.map((point) => point.x)) - padding,
    right: Math.max(...boundsPoints.map((point) => point.x)) + padding,
    top: Math.min(...boundsPoints.map((point) => point.y)) - padding,
  };
}

export function arrowPath(
  start: ArrowPoint,
  end: ArrowPoint,
  bounds: Pick<CanvasFrame, 'left' | 'top'> = { left: 0, top: 0 },
  controlPoints: readonly ArrowPoint[] = [],
): string {
  const points = [start, ...controlPoints, end];
  const point = (value: ArrowPoint): string =>
    `${value.x - bounds.left} ${value.y - bounds.top}`;
  if (points.length < 3) return `M ${point(start)} L ${point(end)}`;

  let path = `M ${point(points[0])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const controls = cubicControls(
      points[index - 1] ?? points[index],
      points[index],
      points[index + 1],
      points[index + 2] ?? points[index + 1],
    );
    path += ` C ${point(controls.first)} ${point(controls.second)} ${point(points[index + 1])}`;
  }
  return path;
}

function cubicControls(
  before: ArrowPoint,
  start: ArrowPoint,
  end: ArrowPoint,
  after: ArrowPoint,
): { first: ArrowPoint; second: ArrowPoint } {
  return {
    first: {
      x: start.x + (end.x - before.x) / 6,
      y: start.y + (end.y - before.y) / 6,
    },
    second: {
      x: end.x - (after.x - start.x) / 6,
      y: end.y - (after.y - start.y) / 6,
    },
  };
}

export function snapArrow(
  arrow: ArrowElement,
  elements: readonly CanvasElement[],
  placements: readonly CanvasPlacement[],
): ArrowElement {
  const next = { ...arrow };
  const start = validAttachment(arrow.startAttachment, elements, placements)
    ? arrow.startAttachment
    : snapPoint(
        { x: arrow.startX, y: arrow.startY },
        arrow,
        elements,
        placements,
      );
  const end = validAttachment(arrow.endAttachment, elements, placements)
    ? arrow.endAttachment
    : snapPoint(
        { x: arrow.endX, y: arrow.endY },
        arrow,
        elements,
        placements,
      );
  if (start) {
    next.startAttachment = start;
    const resolved = resolvePoint(
      next,
      start,
      { x: next.startX, y: next.startY },
      elements,
      placements,
    );
    next.startX = resolved.x;
    next.startY = resolved.y;
  } else delete next.startAttachment;
  if (end) {
    next.endAttachment = end;
    const resolved = resolvePoint(
      next,
      end,
      { x: next.endX, y: next.endY },
      elements,
      placements,
    );
    next.endX = resolved.x;
    next.endY = resolved.y;
  } else delete next.endAttachment;
  return next;
}

function validAttachment(
  attachment: ArrowAttachment | undefined,
  elements: readonly CanvasElement[],
  placements: readonly CanvasPlacement[],
): attachment is ArrowAttachment {
  if (!attachment) return false;
  return attachment.elementId
    ? elements.some((element) => element.id === attachment.elementId)
    : Boolean(
        attachment.objectId &&
        placements.some((placement) => placement.id === attachment.objectId),
      );
}

export function canvasElementFrame(
  element: CanvasElement,
  placements: readonly CanvasPlacement[],
): CanvasFrame | null {
  if (element.type === 'arrow') return null;
  const frame: CanvasFrame = {
    bottom: element.y + element.height,
    left: element.x,
    right: element.x + element.width,
    top: element.y,
  };
  if (!element.parentObjectId) return frame;
  const placement = placements.find((candidate) => candidate.id === element.parentObjectId);
  if (!placement) return null;
  return {
    bottom: placement.y + CANVAS_CARD_HEADER_HEIGHT + frame.bottom,
    left: placement.x + frame.left,
    right: placement.x + frame.right,
    top: placement.y + CANVAS_CARD_HEADER_HEIGHT + frame.top,
  };
}

export function canvasObjectFrame(placement: CanvasPlacement): CanvasFrame {
  return {
    bottom: placement.y + placement.height,
    left: placement.x,
    right: placement.x + placement.width,
    top: placement.y,
  };
}

function resolvePoint(
  arrow: ArrowElement,
  attachment: ArrowAttachment | undefined,
  fallback: ArrowPoint,
  elements: readonly CanvasElement[],
  placements: readonly CanvasPlacement[],
): ArrowPoint {
  if (!attachment) return fallback;
  const globalFrame = attachment.elementId
    ? elements.find((element) => element.id === attachment.elementId)
      ? canvasElementFrame(
          elements.find((element) => element.id === attachment.elementId)!,
          placements,
        )
      : null
    : attachment.objectId
      ? placements.find((placement) => placement.id === attachment.objectId)
        ? canvasObjectFrame(placements.find((placement) => placement.id === attachment.objectId)!)
        : null
      : null;
  if (!globalFrame) return fallback;
  return anchorPoint(localFrame(globalFrame, arrow.parentObjectId, placements), attachment);
}

function snapPoint(
  point: ArrowPoint,
  arrow: ArrowElement,
  elements: readonly CanvasElement[],
  placements: readonly CanvasPlacement[],
): ArrowAttachment | null {
  let nearest: { attachment: ArrowAttachment; distance: number } | null = null;
  for (const element of elements) {
    if (element.id === arrow.id || element.type === 'arrow') continue;
    if (arrow.parentObjectId && element.parentObjectId !== arrow.parentObjectId) continue;
    const frame = canvasElementFrame(element, placements);
    if (!frame) continue;
    const local = localFrame(frame, arrow.parentObjectId, placements);
    const candidate = nearestAnchor(point, local);
    const inside = pointInFrame(point, local);
    if (candidate.distance > ARROW_SNAP_DISTANCE && !inside) continue;
    const distance = inside ? 0 : candidate.distance;
    if (!nearest || distance < nearest.distance) {
      nearest = {
        attachment: { elementId: element.id, offset: candidate.offset, side: candidate.side },
        distance,
      };
    }
  }
  if (!arrow.parentObjectId) {
    for (const placement of placements) {
      const frame = canvasObjectFrame(placement);
      const candidate = nearestAnchor(point, frame);
      const inside = pointInFrame(point, frame);
      if (candidate.distance > ARROW_SNAP_DISTANCE && !inside) continue;
      const distance = inside ? 0 : candidate.distance;
      if (!nearest || distance < nearest.distance) {
        nearest = {
          attachment: { objectId: placement.id, offset: candidate.offset, side: candidate.side },
          distance,
        };
      }
    }
  }
  return nearest?.attachment ?? null;
}

function pointInFrame(point: ArrowPoint, frame: CanvasFrame): boolean {
  return point.x >= frame.left && point.x <= frame.right &&
    point.y >= frame.top && point.y <= frame.bottom;
}

function localFrame(
  frame: CanvasFrame,
  parentObjectId: string | undefined,
  placements: readonly CanvasPlacement[],
): CanvasFrame {
  if (!parentObjectId) return frame;
  const parent = placements.find((placement) => placement.id === parentObjectId);
  if (!parent) return frame;
  const offsetX = parent.x;
  const offsetY = parent.y + CANVAS_CARD_HEADER_HEIGHT;
  return {
    bottom: frame.bottom - offsetY,
    left: frame.left - offsetX,
    right: frame.right - offsetX,
    top: frame.top - offsetY,
  };
}

function nearestAnchor(
  point: ArrowPoint,
  frame: CanvasFrame,
): { distance: number; offset: number; side: ArrowAnchorSide } {
  const leftOffset = clamp01((point.y - frame.top) / Math.max(1, frame.bottom - frame.top));
  const rightOffset = leftOffset;
  const topOffset = clamp01((point.x - frame.left) / Math.max(1, frame.right - frame.left));
  const bottomOffset = topOffset;
  const candidates: Array<{ distance: number; offset: number; side: ArrowAnchorSide }> = [
    {
      distance: Math.hypot(point.x - frame.left, point.y - (frame.top + (frame.bottom - frame.top) * leftOffset)),
      offset: leftOffset,
      side: 'left',
    },
    {
      distance: Math.hypot(point.x - frame.right, point.y - (frame.top + (frame.bottom - frame.top) * rightOffset)),
      offset: rightOffset,
      side: 'right',
    },
    {
      distance: Math.hypot(point.x - (frame.left + (frame.right - frame.left) * topOffset), point.y - frame.top),
      offset: topOffset,
      side: 'top',
    },
    {
      distance: Math.hypot(point.x - (frame.left + (frame.right - frame.left) * bottomOffset), point.y - frame.bottom),
      offset: bottomOffset,
      side: 'bottom',
    },
  ];
  return candidates.sort((left, right) => left.distance - right.distance)[0];
}

function anchorPoint(frame: CanvasFrame, attachment: ArrowAttachment): ArrowPoint {
  const offset = clamp01(attachment.offset);
  if (attachment.side === 'left') {
    return { x: frame.left, y: frame.top + (frame.bottom - frame.top) * offset };
  }
  if (attachment.side === 'right') {
    return { x: frame.right, y: frame.top + (frame.bottom - frame.top) * offset };
  }
  if (attachment.side === 'top') {
    return { x: frame.left + (frame.right - frame.left) * offset, y: frame.top };
  }
  return { x: frame.left + (frame.right - frame.left) * offset, y: frame.bottom };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
