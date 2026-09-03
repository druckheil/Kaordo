import type {
  ArrowAnchorSide,
  ArrowAttachment,
  ArrowElement,
  CanvasElement,
  TextElement,
  TextRangeAnchor,
} from '../domain/workspace';
import type { CanvasPlacement } from '../domain/canvas';
import { CANVAS_CARD_HEADER_HEIGHT, canvasApplicationScale } from './canvas';
import {
  measureTextRangeByElementId,
  measureTextRangeFragmentsByElementId,
  measureTextBlockSizeByElementId,
} from './textLayout';

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
  visualZoom = 1,
): { end: ArrowPoint; start: ArrowPoint } {
  return {
    end: resolvePoint(
      arrow,
      arrow.endAttachment,
      { x: arrow.endX, y: arrow.endY },
      elements,
      placements,
      visualZoom,
    ),
    start: resolvePoint(
      arrow,
      arrow.startAttachment,
      { x: arrow.startX, y: arrow.startY },
      elements,
      placements,
      visualZoom,
    ),
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
  visualZoom = 1,
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
      visualZoom,
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
      visualZoom,
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

/**
 * Resolves the visual box of a selected phrase in the coordinate space used
 * by an arrow. The persisted offsets identify the phrase; when its text block
 * is mounted, native Range geometry supplies the current wrapped coordinates.
 * The old box remains a backwards-compatible fallback for archived documents.
 */
export function canvasTextRangeFrame(
  element: TextElement,
  range: TextRangeAnchor,
  parentObjectId: string | undefined,
  placements: readonly CanvasPlacement[],
  visualZoom = 1,
): CanvasFrame | null {
  const frame = canvasElementFrame(element, placements);
  if (!frame) return null;
  const local = localFrame(frame, parentObjectId, placements);
  const scale = Math.max(0.0001, canvasApplicationScale() * visualZoom);
  const measured = measureTextRangeByElementId(
    element.id,
    range,
    scale,
  );
  const measuredFrame = liveTextFrame(local, element.id, scale);
  return measured
    ? measuredTextRangeFrame(measuredFrame, measured)
    : textRangeFrame(local, range);
}

/**
 * Resolves all visual fragments of a text selection in arrow coordinates.
 * Consumers that only need a bounding box should keep using
 * `canvasTextRangeFrame`; arrows use the fragments to avoid attaching to the
 * blank gap between wrapped lines.
 */
export function canvasTextRangeFrames(
  element: TextElement,
  range: TextRangeAnchor,
  parentObjectId: string | undefined,
  placements: readonly CanvasPlacement[],
  visualZoom = 1,
): CanvasFrame[] | null {
  const frame = canvasElementFrame(element, placements);
  if (!frame) return null;
  const local = localFrame(frame, parentObjectId, placements);
  const scale = Math.max(0.0001, canvasApplicationScale() * visualZoom);
  const measured = measureTextRangeFragmentsByElementId(
    element.id,
    range,
    scale,
  );
  if (!measured?.length) return [textRangeFrame(local, range)];
  const measuredFrame = liveTextFrame(local, element.id, scale);
  return measured.map((fragment) => measuredTextRangeFrame(measuredFrame, fragment));
}

function liveTextFrame(
  persisted: CanvasFrame,
  elementId: string,
  scale: number,
): CanvasFrame {
  const size = measureTextBlockSizeByElementId(elementId, scale);
  if (!size) return persisted;
  return {
    ...persisted,
    bottom: persisted.top + size.height,
    right: persisted.left + size.width,
  };
}

/** Picks the side of a phrase closest to the explanation target. */
export function textRangeSide(
  frame: CanvasFrame,
  target: ArrowPoint,
): ArrowAnchorSide {
  const centerX = (frame.left + frame.right) / 2;
  const centerY = (frame.top + frame.bottom) / 2;
  const deltaX = target.x - centerX;
  const deltaY = target.y - centerY;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX >= 0 ? 'right' : 'left';
  return deltaY >= 0 ? 'bottom' : 'top';
}

/**
 * Chooses the side and the exact relative position where an explanation
 * arrow should leave a phrase. Keeping the offset aligned with the target
 * prevents every multi-line selection from collapsing to its midpoint.
 */
export function textRangeAttachment(
  frame: CanvasFrame,
  target: ArrowPoint,
): Pick<ArrowAttachment, 'offset' | 'side'> {
  const side = textRangeSide(frame, target);
  const offset = side === 'left' || side === 'right'
    ? clamp01((target.y - frame.top) / Math.max(1, frame.bottom - frame.top))
    : clamp01((target.x - frame.left) / Math.max(1, frame.right - frame.left));
  return { offset, side };
}

/**
 * Picks the fragment nearest to an existing attachment. The side and offset
 * are persisted, so this remains deterministic after a resize or a font
 * change while still following the line containing the selected word.
 */
export function textRangeAnchorPoint(
  frames: readonly CanvasFrame[],
  attachment: ArrowAttachment,
): ArrowPoint {
  if (frames.length === 0) return { x: 0, y: 0 };
  if (frames.length === 1) return arrowAnchorPoint(frames[0], attachment);
  const bounds = unionFrames(frames);
  const desired = attachment.side === 'left' || attachment.side === 'right'
    ? bounds.top + (bounds.bottom - bounds.top) * clamp01(attachment.offset)
    : bounds.left + (bounds.right - bounds.left) * clamp01(attachment.offset);
  const nearest = frames.reduce((best, frame) => {
    const coordinate = attachment.side === 'left' || attachment.side === 'right'
      ? (frame.top + frame.bottom) / 2
      : (frame.left + frame.right) / 2;
    const bestCoordinate = attachment.side === 'left' || attachment.side === 'right'
      ? (best.top + best.bottom) / 2
      : (best.left + best.right) / 2;
    return Math.abs(coordinate - desired) < Math.abs(bestCoordinate - desired)
      ? frame
      : best;
  }, frames[0]);
  const localOffset = attachment.side === 'left' || attachment.side === 'right'
    ? clamp01((desired - nearest.top) / Math.max(1, nearest.bottom - nearest.top))
    : clamp01((desired - nearest.left) / Math.max(1, nearest.right - nearest.left));
  return arrowAnchorPoint(nearest, { ...attachment, offset: localOffset });
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
  visualZoom: number,
): ArrowPoint {
  if (!attachment) return fallback;
  const element = attachment.elementId
    ? elements.find((candidate) => candidate.id === attachment.elementId)
    : undefined;
  const placement = attachment.objectId
    ? placements.find((candidate) => candidate.id === attachment.objectId)
    : undefined;
  const globalFrame = element
    ? canvasElementFrame(element, placements)
    : placement
      ? canvasObjectFrame(placement)
      : null;
  if (!globalFrame) return fallback;
  const frame = localFrame(globalFrame, arrow.parentObjectId, placements);
  if (element?.type === 'text' && attachment.textRange) {
    const frames = canvasTextRangeFrames(
      element,
      attachment.textRange,
      arrow.parentObjectId,
      placements,
      visualZoom,
    );
    return textRangeAnchorPoint(
      frames ?? [
        canvasTextRangeFrame(
          element,
          attachment.textRange,
          arrow.parentObjectId,
          placements,
          visualZoom,
        ) ?? textRangeFrame(frame, attachment.textRange),
      ],
      attachment,
    );
  }
  return arrowAnchorPoint(frame, attachment);
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

export function arrowAnchorPoint(frame: CanvasFrame, attachment: ArrowAttachment): ArrowPoint {
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

function textRangeFrame(frame: CanvasFrame, range: TextRangeAnchor): CanvasFrame {
  const width = Math.max(1, frame.right - frame.left);
  const height = Math.max(1, frame.bottom - frame.top);
  const left = frame.left + clamp(range.x, 0, width);
  const top = frame.top + clamp(range.y, 0, height);
  const right = Math.min(frame.right, left + Math.max(1, range.width));
  const bottom = Math.min(frame.bottom, top + Math.max(1, range.height));
  return {
    bottom: Math.max(top + 1, bottom),
    left,
    right: Math.max(left + 1, right),
    top,
  };
}

function measuredTextRangeFrame(
  frame: CanvasFrame,
  measured: { height: number; width: number; x: number; y: number },
): CanvasFrame {
  // A transformed WebView can briefly report a Range rect one frame outside
  // its text block while the block is being resized. Clamp the live result
  // to the logical block bounds so an arrow never flies to that stale rect.
  const width = Math.max(1, frame.right - frame.left);
  const height = Math.max(1, frame.bottom - frame.top);
  const left = frame.left + clamp(measured.x, 0, width);
  const top = frame.top + clamp(measured.y, 0, height);
  const measuredWidth = Math.min(
    Math.max(1, measured.width),
    Math.max(1, frame.right - left),
  );
  const measuredHeight = Math.min(
    Math.max(1, measured.height),
    Math.max(1, frame.bottom - top),
  );
  return {
    bottom: top + measuredHeight,
    left,
    right: left + measuredWidth,
    top,
  };
}

function unionFrames(frames: readonly CanvasFrame[]): CanvasFrame {
  return {
    bottom: Math.max(...frames.map((frame) => frame.bottom)),
    left: Math.min(...frames.map((frame) => frame.left)),
    right: Math.max(...frames.map((frame) => frame.right)),
    top: Math.min(...frames.map((frame) => frame.top)),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
