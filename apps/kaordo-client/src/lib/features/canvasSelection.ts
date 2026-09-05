import type { ArrowElement, CanvasElement } from '../domain/workspace';

export type CanvasSelection =
  | { id: string; kind: 'element' }
  | { id: string; kind: 'panel' };

export type CanvasSelectionOptions = {
  /** Add or remove the item instead of replacing the current selection. */
  additive?: boolean;
};

/**
 * Lookup tables shared by the canvas renderers and selection helpers.
 *
 * Canvas documents intentionally stay flat on disk. Building the two small
 * indexes once per document keeps hierarchy walks O(n) instead of repeatedly
 * scanning the complete element array for every tree row or rendered node.
 */
export type CanvasElementLookup = {
  readonly byId: ReadonlyMap<string, CanvasElement>;
  readonly childrenByParent: ReadonlyMap<string, readonly CanvasElement[]>;
};

export function createCanvasElementLookup(
  elements: readonly CanvasElement[],
): CanvasElementLookup {
  const byId = new Map<string, CanvasElement>();
  const childrenByParent = new Map<string, CanvasElement[]>();
  for (const element of elements) {
    byId.set(element.id, element);
    if (!('parentElementId' in element) || !element.parentElementId) continue;
    const children = childrenByParent.get(element.parentElementId) ?? [];
    children.push(element);
    childrenByParent.set(element.parentElementId, children);
  }
  return { byId, childrenByParent };
}

export type CanvasSelectionResolver = {
  readonly roots: readonly CanvasElement[];
  readonly ids: ReadonlySet<string>;
  isHighlighted(element: CanvasElement): boolean;
};

/**
 * Precomputes all selection relationships for one render pass. Consumers can
 * then ask for a row's highlight state without rebuilding selection sets or
 * walking the document for every row.
 */
export function createCanvasSelectionResolver(
  selections: readonly CanvasSelection[],
  elements: readonly CanvasElement[],
  fallback?: CanvasElement,
): CanvasSelectionResolver {
  const lookup = createCanvasElementLookup(elements);
  const selected = selectionSets(selections);
  const roots = selectedElementRoots(selections, elements, fallback, lookup);
  const ids = new Set<string>();
  for (const root of roots) {
    ids.add(root.id);
    collectDescendants(root.id, lookup, ids);
  }

  const highlighted = new Set<string>();
  for (const element of elements) {
    if (isHighlightedWithLookup(element, selected, lookup)) {
      highlighted.add(element.id);
    }
  }
  return {
    roots,
    ids,
    isHighlighted: (element) => highlighted.has(element.id),
  };
}

/** Returns true for the modifiers used by native canvas/tree multi-selection. */
export function isCanvasSelectionModifier(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

export function selectionKey(selection: CanvasSelection): string {
  return `${selection.kind}:${selection.id}`;
}

/** Returns whether an item is already part of the explicit selection. */
export function isCanvasSelectionActive(
  selections: readonly CanvasSelection[],
  target: CanvasSelection,
): boolean {
  return selections.some((selection) => selectionKey(selection) === selectionKey(target));
}

/**
 * Finds the selected element roots for one rendered board. Descendants of an
 * already-selected element are omitted because moving the parent already
 * moves its complete hierarchy.
 */
export function selectedElementRoots(
  selections: readonly CanvasSelection[],
  elements: readonly CanvasElement[],
  fallback?: CanvasElement,
  lookup: CanvasElementLookup = createCanvasElementLookup(elements),
): CanvasElement[] {
  const selectedIds = selectionSets(selections).elementIds;
  const candidates = elements.filter((element) => selectedIds.has(element.id));
  const roots = candidates.filter((element) =>
    !hasSelectedAncestor(element, selectedIds, lookup),
  );
  if (roots.length > 0) return roots;
  return fallback ? [fallback] : [];
}

/** Returns every selected root and its nested descendants. */
export function selectedElementIds(
  selections: readonly CanvasSelection[],
  elements: readonly CanvasElement[],
  fallback?: CanvasElement,
  lookup: CanvasElementLookup = createCanvasElementLookup(elements),
): Set<string> {
  const roots = selectedElementRoots(selections, elements, fallback, lookup);
  const ids = new Set<string>();
  for (const root of roots) {
    ids.add(root.id);
    collectDescendants(root.id, lookup, ids);
  }
  return ids;
}

/** Highlights an element when it or one of its ancestors is selected. */
export function isCanvasElementHighlighted(
  element: CanvasElement,
  selections: readonly CanvasSelection[],
  elements: readonly CanvasElement[],
  lookup: CanvasElementLookup = createCanvasElementLookup(elements),
): boolean {
  return isHighlightedWithLookup(
    element,
    selectionSets(selections),
    lookup,
  );
}

function isHighlightedWithLookup(
  element: CanvasElement,
  selected: SelectionSets,
  lookup: CanvasElementLookup,
): boolean {
  if (selected.elementIds.has(element.id)) return true;

  let current: CanvasElement | undefined = element;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);

    // Arrows have no parentElementId. Their start attachment is the logical
    // owner used by Contents, so follow it for selection highlighting too.
    // This keeps an attached arrow highlighted when its source element or
    // source panel is selected, including arrows spanning two panels.
    if (current.type === 'arrow') {
      const source: ArrowElement['startAttachment'] = current.startAttachment;
      if (source?.objectId && selected.panelIds.has(source.objectId)) return true;
      if (source?.elementId) {
        if (selected.elementIds.has(source.elementId)) return true;
        const sourceElement = lookup.byId.get(source.elementId);
        if (
          sourceElement
          && sourceElement.type !== 'arrow'
          && !visited.has(sourceElement.id)
        ) {
          current = sourceElement;
          continue;
        }
      }
    }

    const parentObjectId = current.parentObjectId;
    if (parentObjectId && selected.panelIds.has(parentObjectId)) return true;
    const parentId: string | undefined = 'parentElementId' in current
      ? current.parentElementId
      : undefined;
    if (!parentId) break;
    if (selected.elementIds.has(parentId)) return true;
    current = lookup.byId.get(parentId);
  }
  return false;
}

export function isCanvasPanelHighlighted(
  panelId: string,
  selections: readonly CanvasSelection[],
): boolean {
  return selections.some((selection) =>
    selection.kind === 'panel' && selection.id === panelId,
  );
}

/** Translate an element's persisted geometry without changing its identity. */
export function translateCanvasElement(
  element: CanvasElement,
  deltaX: number,
  deltaY: number,
): CanvasElement {
  if (element.type === 'arrow') {
    return {
      ...element,
      controlPoints: element.controlPoints.map((point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      })),
      endX: element.endX + deltaX,
      endY: element.endY + deltaY,
      startX: element.startX + deltaX,
      startY: element.startY + deltaY,
    };
  }
  return {
    ...element,
    x: element.x + deltaX,
    y: element.y + deltaY,
  };
}

function hasSelectedAncestor(
  element: CanvasElement,
  selectedIds: ReadonlySet<string>,
  lookup: CanvasElementLookup,
): boolean {
  const visited = new Set<string>();
  let parentId = 'parentElementId' in element
    ? element.parentElementId
    : undefined;
  while (parentId && !visited.has(parentId)) {
    if (selectedIds.has(parentId)) return true;
    visited.add(parentId);
    const parent = lookup.byId.get(parentId);
    parentId = parent && 'parentElementId' in parent
      ? parent.parentElementId
      : undefined;
  }
  return false;
}

function collectDescendants(
  parentId: string,
  lookup: CanvasElementLookup,
  ids: Set<string>,
): void {
  for (const element of lookup.childrenByParent.get(parentId) ?? []) {
    if (ids.has(element.id)) continue;
    ids.add(element.id);
    collectDescendants(element.id, lookup, ids);
  }
}

type SelectionSets = {
  readonly elementIds: ReadonlySet<string>;
  readonly panelIds: ReadonlySet<string>;
};

function selectionSets(selections: readonly CanvasSelection[]): SelectionSets {
  const elementIds = new Set<string>();
  const panelIds = new Set<string>();
  for (const selection of selections) {
    (selection.kind === 'element' ? elementIds : panelIds).add(selection.id);
  }
  return { elementIds, panelIds };
}
