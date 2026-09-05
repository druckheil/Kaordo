import type { ArrowElement, CanvasElement } from '../domain/workspace';

export type CanvasSelection =
  | { id: string; kind: 'element' }
  | { id: string; kind: 'panel' };

export type CanvasSelectionOptions = {
  /** Add or remove the item instead of replacing the current selection. */
  additive?: boolean;
};

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
): CanvasElement[] {
  const selectedIds = new Set(
    selections
      .filter((selection) => selection.kind === 'element')
      .map((selection) => selection.id),
  );
  const candidates = elements.filter((element) => selectedIds.has(element.id));
  const roots = candidates.filter((element) =>
    !hasSelectedAncestor(element, selectedIds, elements),
  );
  if (roots.length > 0) return roots;
  return fallback ? [fallback] : [];
}

/** Returns every selected root and its nested descendants. */
export function selectedElementIds(
  selections: readonly CanvasSelection[],
  elements: readonly CanvasElement[],
  fallback?: CanvasElement,
): Set<string> {
  const roots = selectedElementRoots(selections, elements, fallback);
  const ids = new Set<string>();
  for (const root of roots) {
    ids.add(root.id);
    collectDescendants(root.id, elements, ids);
  }
  return ids;
}

/** Highlights an element when it or one of its ancestors is selected. */
export function isCanvasElementHighlighted(
  element: CanvasElement,
  selections: readonly CanvasSelection[],
  elements: readonly CanvasElement[],
): boolean {
  if (selections.some((selection) =>
    selection.kind === 'element' && selection.id === element.id,
  )) return true;

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
      if (source?.objectId && selections.some((selection) =>
        selection.kind === 'panel' && selection.id === source.objectId,
      )) return true;
      if (source?.elementId) {
        if (selections.some((selection) =>
          selection.kind === 'element' && selection.id === source.elementId,
        )) return true;
        const sourceElement: CanvasElement | undefined = elements.find((candidate) =>
          candidate.id === source.elementId,
        );
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
    if (parentObjectId && selections.some((selection) =>
      selection.kind === 'panel' && selection.id === parentObjectId,
    )) return true;
    const parentId: string | undefined = 'parentElementId' in current
      ? current.parentElementId
      : undefined;
    if (!parentId) break;
    if (selections.some((selection) =>
      selection.kind === 'element' && selection.id === parentId,
    )) return true;
    current = elements.find((candidate) => candidate.id === parentId);
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
  elements: readonly CanvasElement[],
): boolean {
  const visited = new Set<string>();
  let parentId = 'parentElementId' in element
    ? element.parentElementId
    : undefined;
  while (parentId && !visited.has(parentId)) {
    if (selectedIds.has(parentId)) return true;
    visited.add(parentId);
    const parent = elements.find((candidate) => candidate.id === parentId);
    parentId = parent && 'parentElementId' in parent
      ? parent.parentElementId
      : undefined;
  }
  return false;
}

function collectDescendants(
  parentId: string,
  elements: readonly CanvasElement[],
  ids: Set<string>,
): void {
  for (const element of elements) {
    if (!('parentElementId' in element) || element.parentElementId !== parentId) continue;
    if (ids.has(element.id)) continue;
    ids.add(element.id);
    collectDescendants(element.id, elements, ids);
  }
}
