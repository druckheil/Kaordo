import type { CanvasElement } from '../domain/workspace';

/**
 * The parent used by the Contents projection. Arrows intentionally use their
 * start attachment as their owner so a cross-panel arrow remains in the
 * hierarchy where it originates.
 */
export type ContentHierarchyParent =
  | { id: string; kind: 'element' }
  | { id: string; kind: 'panel' }
  | undefined;

/**
 * Resolve the logical parent for an element shown in Klaro's Contents tree.
 *
 * Persisted canvas elements are flat, while the tree is hierarchical. Text
 * and media keep their explicit parentElementId relationship. Arrows do not
 * have a parentElementId, so their start attachment is the authoritative
 * owner. This also fixes arrows that are attached to an element but have no
 * parentObjectId (a valid state for arrows spanning panels).
 */
export function contentHierarchyParentFor(
  element: CanvasElement,
  elements: readonly CanvasElement[],
  panelIds: ReadonlySet<string>,
): ContentHierarchyParent {
  return resolveContentHierarchyParent(
    element,
    new Map(elements.map((candidate) => [candidate.id, candidate])),
    panelIds,
  );
}

/**
 * Create a resolver for one document. Contents asks for a parent once per
 * element, so keeping this index outside the loop avoids repeated O(n) scans.
 */
export function createContentHierarchyResolver(
  elements: readonly CanvasElement[],
  panelIds: ReadonlySet<string>,
): (element: CanvasElement) => ContentHierarchyParent {
  const byId = new Map(elements.map((candidate) => [candidate.id, candidate]));
  return (element) => resolveContentHierarchyParent(element, byId, panelIds);
}

function resolveContentHierarchyParent(
  element: CanvasElement,
  byId: ReadonlyMap<string, CanvasElement>,
  panelIds: ReadonlySet<string>,
): ContentHierarchyParent {

  if (element.type === 'arrow') {
    const source = element.startAttachment;
    if (source?.elementId) {
      const sourceElement = byId.get(source.elementId);
      // Arrows are endpoints, not containers. Avoid creating a nonsensical
      // arrow-inside-arrow branch if a malformed document references one.
      if (sourceElement && sourceElement.type !== 'arrow' && sourceElement.id !== element.id) {
        return { id: sourceElement.id, kind: 'element' };
      }
    }
    if (source?.objectId && panelIds.has(source.objectId)) {
      return { id: source.objectId, kind: 'panel' };
    }
    if (element.parentObjectId && panelIds.has(element.parentObjectId)) {
      return { id: element.parentObjectId, kind: 'panel' };
    }
    return undefined;
  }

  if ('parentElementId' in element && element.parentElementId) {
    const parent = byId.get(element.parentElementId);
    if (parent && parent.type !== 'arrow' && parent.id !== element.id) {
      return { id: parent.id, kind: 'element' };
    }
  }

  if (element.parentObjectId && panelIds.has(element.parentObjectId)) {
    return { id: element.parentObjectId, kind: 'panel' };
  }
  return undefined;
}

/** Return the stable node key used by Contents for a canvas element. */
export function contentNodeKeyFor(element: CanvasElement): string {
  switch (element.type) {
    case 'rectangle':
      return `card:${element.id}`;
    case 'text':
      return `text:${element.id}`;
    case 'media':
      return `media:${element.id}`;
    case 'arrow':
      return `arrow:${element.id}`;
  }
}

/** Convert a resolved parent to the corresponding Contents node key. */
export function contentParentKeyFor(
  parent: ContentHierarchyParent,
  elementKeys: ReadonlyMap<string, string>,
): string | undefined {
  if (!parent) return undefined;
  if (parent.kind === 'panel') return `panel:${parent.id}`;
  return elementKeys.get(parent.id);
}
