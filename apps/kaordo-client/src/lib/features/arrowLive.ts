export const ARROW_LIVE_DRAG_EVENT = 'kaordo-arrow-live-drag';

export type ArrowHandle = 'end' | 'start' | number;

export type ArrowLiveDragDetail = {
  deltaX: number;
  deltaY: number;
  arrowId?: string;
  controlPoint?: number;
  endpoint?: 'end' | 'start';
  elementId?: string;
  /** All descendants that moved with elementId in this frame. */
  elementIds?: readonly string[];
  objectId?: string;
  phase: 'end' | 'move';
};

export function dispatchArrowLiveDrag(detail: ArrowLiveDragDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ArrowLiveDragDetail>(ARROW_LIVE_DRAG_EVENT, {
    detail,
  }));
}
