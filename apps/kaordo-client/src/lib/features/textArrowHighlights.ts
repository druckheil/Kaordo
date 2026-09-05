import type { CanvasElement, TextRangeAnchor } from '../domain/workspace';

export type TextArrowHighlight = {
  anchor: TextRangeAnchor;
  color: string;
};

/**
 * Indexes visible text outlines by their source text element. Text blocks are
 * rendered independently, so a map avoids filtering every arrow once per
 * text block during each canvas update.
 */
export function createTextArrowHighlightIndex(
  elements: readonly CanvasElement[],
): ReadonlyMap<string, readonly TextArrowHighlight[]> {
  const index = new Map<string, TextArrowHighlight[]>();
  for (const element of elements) {
    if (
      element.type !== 'arrow' ||
      !element.showTextOutline ||
      !element.startAttachment?.elementId ||
      !element.startAttachment.textRange
    ) continue;
    const sourceId = element.startAttachment.elementId;
    const highlights = index.get(sourceId) ?? [];
    highlights.push({
      anchor: element.startAttachment.textRange,
      color: element.stroke,
    });
    index.set(sourceId, highlights);
  }
  return index;
}
