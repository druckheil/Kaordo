import type { CanvasElement } from '../domain/workspace';
import { dispatchArrowLiveDrag, type ArrowHandle } from './arrowLive';

export type CanvasLiveMove = {
  arrowHandle?: ArrowHandle;
  element: CanvasElement;
};

/** Broadcasts one frame of an element move to attached arrows. */
export function dispatchCanvasLiveMove(
  move: CanvasLiveMove,
  elements: readonly CanvasElement[],
  deltaX: number,
  deltaY: number,
): void {
  if (move.element.type === 'arrow' && move.arrowHandle !== undefined) {
    if (typeof move.arrowHandle === 'number') {
      dispatchArrowLiveDrag({
        arrowId: move.element.id,
        controlPoint: move.arrowHandle,
        deltaX,
        deltaY,
        phase: 'move',
      });
      return;
    }
    dispatchArrowLiveDrag({
      arrowId: move.element.id,
      deltaX,
      deltaY,
      endpoint: move.arrowHandle,
      phase: 'move',
    });
    return;
  }
  for (const elementId of liveTargetIds(move.element, elements)) {
    dispatchArrowLiveDrag({ elementId, deltaX, deltaY, phase: 'move' });
  }
}

/** Clears the live offset after the committed canvas state is rendered. */
export function dispatchCanvasLiveEnd(
  move: CanvasLiveMove,
  elements: readonly CanvasElement[],
): void {
  if (move.element.type === 'arrow' && move.arrowHandle !== undefined) {
    if (typeof move.arrowHandle === 'number') {
      dispatchArrowLiveDrag({
        arrowId: move.element.id,
        controlPoint: move.arrowHandle,
        deltaX: 0,
        deltaY: 0,
        phase: 'end',
      });
      return;
    }
    dispatchArrowLiveDrag({
      arrowId: move.element.id,
      deltaX: 0,
      deltaY: 0,
      endpoint: move.arrowHandle,
      phase: 'end',
    });
    return;
  }
  for (const elementId of liveTargetIds(move.element, elements)) {
    dispatchArrowLiveDrag({ elementId, deltaX: 0, deltaY: 0, phase: 'end' });
  }
}

function liveTargetIds(
  element: CanvasElement,
  elements: readonly CanvasElement[],
): string[] {
  const ids = [element.id];
  if (element.type !== 'rectangle') return ids;
  for (const child of elements) {
    if (
      (child.type === 'text' || child.type === 'media') &&
      child.parentElementId === element.id
    ) ids.push(child.id);
  }
  return ids;
}
