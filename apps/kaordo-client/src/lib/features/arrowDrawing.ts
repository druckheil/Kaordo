import type { ArrowElement } from '../domain/workspace';
import { ARROW_MIN_LENGTH } from './arrowGeometry';

export type ArrowDrawGesture = {
  currentX: number;
  currentY: number;
  kind: 'draw-arrow';
  pointerId: number;
  startX: number;
  startY: number;
};

export function startArrowDraw(
  point: { x: number; y: number },
  pointerId: number,
): ArrowDrawGesture {
  return {
    currentX: point.x,
    currentY: point.y,
    kind: 'draw-arrow',
    pointerId,
    startX: point.x,
    startY: point.y,
  };
}

export function continueArrowDraw(
  gesture: ArrowDrawGesture,
  point: { x: number; y: number },
): ArrowDrawGesture {
  return { ...gesture, currentX: point.x, currentY: point.y };
}

export function isArrowDrawValid(gesture: ArrowDrawGesture): boolean {
  return Math.hypot(
    gesture.currentX - gesture.startX,
    gesture.currentY - gesture.startY,
  ) >= ARROW_MIN_LENGTH;
}

export function arrowFromGesture(
  gesture: ArrowDrawGesture,
  id: string,
  stroke: string,
  parentObjectId?: string,
): ArrowElement {
  const left = Math.min(gesture.startX, gesture.currentX);
  const top = Math.min(gesture.startY, gesture.currentY);
  const arrow: ArrowElement = {
    controlPoints: [{
      x: (gesture.startX + gesture.currentX) / 2,
      y: (gesture.startY + gesture.currentY) / 2,
    }],
    endX: gesture.currentX,
    endY: gesture.currentY,
    headMode: 'end',
    height: Math.max(1, Math.abs(gesture.currentY - gesture.startY)),
    id,
    startX: gesture.startX,
    startY: gesture.startY,
    stroke,
    strokeWidth: 2.5,
    type: 'arrow',
    lineStyle: 'solid',
    width: Math.max(1, Math.abs(gesture.currentX - gesture.startX)),
    x: left,
    y: top,
  };
  if (parentObjectId) arrow.parentObjectId = parentObjectId;
  return arrow;
}
