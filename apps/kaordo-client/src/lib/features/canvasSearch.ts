import type {
  CanvasElement,
  ObjectSummary,
  WorkspaceDetail,
} from '../domain/workspace';
import { textElementLabel } from '../domain/workspace';

const DEFAULT_RESULT_LIMIT = 50;

export type CanvasSearchPanelResult = {
  id: string;
  key: string;
  kind: 'panel';
  label: string;
  object: ObjectSummary;
  searchText: string;
  subtitle: string;
};

export type CanvasSearchElementResult = {
  element: CanvasElement;
  id: string;
  key: string;
  kind: 'element';
  label: string;
  searchText: string;
  subtitle: string;
};

export type CanvasSearchResult = CanvasSearchPanelResult | CanvasSearchElementResult;

/**
 * Ephemeral canvas target used to draw a short visual confirmation after a
 * search result is chosen. It is intentionally not persisted with a file.
 */
export type CanvasSearchHighlight = {
  id: string;
  kind: 'element' | 'panel';
  query: string;
  token: number;
};

/**
 * Search the already-loaded Klaro document without touching the network.
 * Keeping this projection pure lets the header stay responsive while the
 * Canvas remains responsible for selection and viewport focus.
 */
export function searchCanvasContent(
  workspace: WorkspaceDetail | null,
  elements: readonly CanvasElement[],
  query: string,
  limit = DEFAULT_RESULT_LIMIT,
): CanvasSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!workspace || !normalizedQuery || limit <= 0) return [];

  const results: CanvasSearchResult[] = [];
  const matches = (searchText: string): boolean =>
    searchText.toLocaleLowerCase().includes(normalizedQuery);

  for (const object of workspace.objects) {
    const label = object.title.trim() || 'Untitled panel';
    const subtitle = 'Panel';
    const searchText = `${label} ${subtitle} ${object.type}`;
    if (!matches(searchText)) continue;
    results.push({
      id: object.id,
      key: `panel:${object.id}`,
      kind: 'panel',
      label,
      object,
      searchText,
      subtitle,
    });
    if (results.length >= limit) return results;
  }

  let cardNumber = 0;
  for (const element of elements) {
    const result = searchResultForElement(
      element,
      element.type === 'rectangle' ? ++cardNumber : cardNumber,
    );
    if (!result || !matches(result.searchText)) continue;
    results.push(result);
    if (results.length >= limit) break;
  }
  return results;
}

function searchResultForElement(
  element: CanvasElement,
  cardNumber: number,
): CanvasSearchElementResult | null {
  if (element.type === 'rectangle') {
    const label = `Card ${cardNumber}`;
    const subtitle = element.parentObjectId ? 'Card · Panel' : 'Card · Canvas';
    return elementResult(element, label, subtitle);
  }

  if (element.type === 'text') {
    const label = textElementLabel(element);
    const subtitle = element.parentElementId
      ? 'Text · Card'
      : element.parentObjectId ? 'Text · Panel' : 'Text · Canvas';
    const fullText = textElementPlainText(element.html);
    return elementResult(element, label, subtitle, `${label} ${fullText} ${subtitle}`);
  }

  if (element.type === 'media') {
    const label = element.name.trim() || 'Untitled media';
    const subtitle = `${element.kind} · ${element.parentElementId
      ? 'Card'
      : element.parentObjectId ? 'Panel' : 'Canvas'}`;
    return elementResult(
      element,
      label,
      subtitle,
      `${label} ${subtitle} ${element.mimeType} ${element.mediaId}`,
    );
  }

  const sourceQuote = element.startAttachment?.textRange?.quote?.trim() ?? '';
  const label = 'Arrow';
  const subtitle = sourceQuote
    ? `Arrow · “${sourceQuote.slice(0, 72)}${sourceQuote.length > 72 ? '…' : ''}”`
    : element.parentObjectId ? 'Arrow · Panel' : 'Arrow · Canvas';
  return elementResult(
    element,
    label,
    subtitle,
    sourceQuote ? `${label} ${subtitle} ${sourceQuote}` : undefined,
  );
}

function elementResult(
  element: CanvasElement,
  label: string,
  subtitle: string,
  searchText = `${label} ${subtitle}`,
): CanvasSearchElementResult {
  return {
    element,
    id: element.id,
    key: `element:${element.id}`,
    kind: 'element',
    label,
    searchText,
    subtitle,
  };
}

function textElementPlainText(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
