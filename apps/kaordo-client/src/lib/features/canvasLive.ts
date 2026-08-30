import type { CanvasElement } from '../domain/workspace';
import { canvasElementIdsForElement } from '../domain/workspace';
import { dispatchArrowLiveDrag, type ArrowHandle } from './arrowLive';

export type CanvasLiveMove = {
  arrowHandle?: ArrowHandle;
  element: CanvasElement;
  /**
   * Descendants captured when the gesture starts. Reusing this list keeps
   * pointer-move frames allocation-free; callers that do not have a cached
   * list retain the safe document-derived fallback.
   */
  elementIds?: readonly string[];
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
  const elementIds = move.elementIds ?? liveTargetIds(move.element, elements);
  dispatchArrowLiveDrag({
    deltaX,
    deltaY,
    elementId: move.element.id,
    elementIds,
    phase: 'move',
  });
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
  const elementIds = move.elementIds ?? liveTargetIds(move.element, elements);
  dispatchArrowLiveDrag({
    deltaX: 0,
    deltaY: 0,
    elementId: move.element.id,
    elementIds,
    phase: 'end',
  });
}

function liveTargetIds(
  element: CanvasElement,
  elements: readonly CanvasElement[],
): string[] {
  return [...canvasElementIdsForElement(elements, element.id)];
}
