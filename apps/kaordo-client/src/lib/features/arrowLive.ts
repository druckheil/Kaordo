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
  /** Panels that moved together in this frame. */
  objectIds?: readonly string[];
  objectId?: string;
  phase: 'end' | 'move';
};

export type ArrowLiveDragSubscription = {
  arrowIds?: readonly string[];
  elementIds?: readonly string[];
  objectIds?: readonly string[];
};

type ArrowLiveDragListener = (detail: ArrowLiveDragDetail) => void;

const listenersByArrowId = new Map<string, Set<ArrowLiveDragListener>>();
const listenersByElementId = new Map<string, Set<ArrowLiveDragListener>>();
const listenersByObjectId = new Map<string, Set<ArrowLiveDragListener>>();

/**
 * Subscribes to only the live-drag targets that can affect one arrow.
 *
 * The DOM event remains available for external integrations, but canvas
 * arrows use this indexed path so a drag does not wake every arrow on the
 * workspace.
 */
export function subscribeArrowLiveDrag(
  subscription: ArrowLiveDragSubscription,
  listener: ArrowLiveDragListener,
): () => void {
  const registrations: Array<{
    index: Map<string, Set<ArrowLiveDragListener>>;
    key: string;
  }> = [];
  const register = (
    index: Map<string, Set<ArrowLiveDragListener>>,
    keys: readonly string[] | undefined,
  ) => {
    for (const key of new Set(keys ?? [])) {
      if (!key) continue;
      const listeners = index.get(key) ?? new Set<ArrowLiveDragListener>();
      listeners.add(listener);
      index.set(key, listeners);
      registrations.push({ index, key });
    }
  };

  register(listenersByArrowId, subscription.arrowIds);
  register(listenersByElementId, subscription.elementIds);
  register(listenersByObjectId, subscription.objectIds);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const { index, key } of registrations) {
      const listeners = index.get(key);
      if (!listeners) continue;
      listeners.delete(listener);
      if (listeners.size === 0) index.delete(key);
    }
  };
}

export function dispatchArrowLiveDrag(detail: ArrowLiveDragDetail): void {
  const listeners = new Set<ArrowLiveDragListener>();
  addListeners(listenersByArrowId, detail.arrowId, listeners);
  addListeners(listenersByElementId, detail.elementId, listeners);
  for (const elementId of detail.elementIds ?? []) {
    addListeners(listenersByElementId, elementId, listeners);
  }
  addListeners(listenersByObjectId, detail.objectId, listeners);
  for (const objectId of detail.objectIds ?? []) {
    addListeners(listenersByObjectId, objectId, listeners);
  }
  for (const listener of listeners) listener(detail);

  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ArrowLiveDragDetail>(ARROW_LIVE_DRAG_EVENT, {
    detail,
  }));
}

function addListeners(
  index: Map<string, Set<ArrowLiveDragListener>>,
  key: string | undefined,
  target: Set<ArrowLiveDragListener>,
): void {
  if (!key) return;
  for (const listener of index.get(key) ?? []) target.add(listener);
}
