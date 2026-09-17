type VisibilityCallback = (visible: boolean) => void;

type VisibilityTarget = {
  callback: VisibilityCallback;
  once: boolean;
};

type SharedVisibilityObserver = {
  observer: IntersectionObserver;
  targets: Map<Element, VisibilityTarget>;
};

type ObserverOptions = {
  once?: boolean;
  rootMargin?: string;
};

const observers = new Map<Element | null, Map<string, SharedVisibilityObserver>>();
const suspendedRoots = new Set<Element>();

/**
 * Shares one IntersectionObserver per canvas viewport and margin. Canvas
 * documents can contain hundreds of nodes; one observer per node adds a
 * surprising amount of work to every scroll boundary crossing.
 */
export function observeCanvasVisibility(
  element: Element,
  root: Element | null,
  onVisibilityChange: VisibilityCallback,
  options: ObserverOptions = {},
): () => void {
  const rootMargin = options.rootMargin ?? '420px';
  const once = options.once === true;
  if (typeof IntersectionObserver !== 'function') {
    onVisibilityChange(true);
    return () => undefined;
  }

  let rootObservers = observers.get(root);
  if (!rootObservers) {
    rootObservers = new Map<string, SharedVisibilityObserver>();
    observers.set(root, rootObservers);
  }

  let shared = rootObservers.get(rootMargin);
  if (!shared) {
    const targets = new Map<Element, VisibilityTarget>();
    const observer = new IntersectionObserver((entries) => {
      // A canvas zoom changes the visual bounds of every target at once. Let
      // the browser finish that transform before running hundreds of class
      // toggles/Svelte updates; the viewport service refreshes the observers
      // once the final zoom is committed.
      const zooming = root instanceof HTMLElement &&
        root.classList.contains('canvas-viewport--zooming');
      if (zooming) return;
      for (const entry of entries) {
        const target = targets.get(entry.target);
        if (!target) continue;
        target.callback(entry.isIntersecting);
        if (!target.once || !entry.isIntersecting) continue;
        targets.delete(entry.target);
        observer.unobserve(entry.target);
      }
      if (targets.size === 0 && observers.get(root)?.get(rootMargin)?.observer === observer) {
        observer.disconnect();
        const currentRootObservers = observers.get(root);
        currentRootObservers?.delete(rootMargin);
        if (currentRootObservers?.size === 0) observers.delete(root);
      }
    }, {
      root,
      rootMargin,
      threshold: 0,
    });
    shared = { observer, targets };
    rootObservers.set(rootMargin, shared);
  }

  shared.targets.set(element, {
    callback: onVisibilityChange,
    once,
  });
  if (!root || !suspendedRoots.has(root)) {
    shared.observer.observe(element);
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const currentRootObservers = observers.get(root);
    const current = currentRootObservers?.get(rootMargin);
    if (!current) return;
    current.targets.delete(element);
    current.observer.unobserve(element);
    if (current.targets.size !== 0) return;
    if (root) suspendedRoots.delete(root);
    current.observer.disconnect();
    currentRootObservers?.delete(rootMargin);
    if (currentRootObservers?.size === 0) observers.delete(root);
  };
}

/** Stops IntersectionObserver geometry work while the whole canvas is being
 * transformed. The target map is retained so resume can observe everything
 * again without remounting any canvas component. */
export function suspendCanvasVisibility(root: Element | null): void {
  if (!root || suspendedRoots.has(root)) return;
  suspendedRoots.add(root);
  for (const shared of observers.get(root)?.values() ?? []) {
    shared.observer.disconnect();
  }
}

/**
 * Re-evaluates all canvas visibility targets after a batched zoom transform.
 * Re-observing forces IntersectionObserver to report the current geometry
 * without doing visibility work on every intermediate zoom frame.
 */
export function refreshCanvasVisibility(root: Element | null): void {
  if (root) suspendedRoots.delete(root);
  const rootObservers = observers.get(root);
  if (!rootObservers) return;
  for (const shared of rootObservers.values()) {
    shared.observer.disconnect();
    for (const element of shared.targets.keys()) {
      shared.observer.observe(element);
    }
  }
}

/** Loads a media resource the first time its preview approaches the viewport. */
export function observeCanvasMedia(
  element: Element,
  root: Element | null,
  onVisible: () => void,
): () => void {
  return observeCanvasVisibility(
    element,
    root,
    (visible) => {
      if (visible) onVisible();
    },
    { once: true, rootMargin: '320px' },
  );
}
