import type { TextRangeAnchor, TextWordAnchor } from '../domain/workspace';

/** A phrase box in the local coordinate space of its text block. */
export type TextRangeFrame = {
  height: number;
  width: number;
  x: number;
  y: number;
};

/**
 * A range can have more than one visual fragment when it wraps to another
 * line. Keeping the fragments separate lets an arrow attach to the line that
 * is actually closest to its target instead of the empty space between lines.
 */
export type TextRangeFragment = TextRangeFrame;

/**
 * The text layout event is intentionally small and DOM-local. Text layout is
 * ephemeral browser state, so it must not be persisted with the workspace.
 * Canvas arrows listen to this event to re-read Range geometry after a block
 * resize, edit, or font/layout change.
 */
export const TEXT_LAYOUT_CHANGED_EVENT = 'kaordo:text-layout-changed';
/** Detail value used when a canvas-wide transform invalidates every range. */
export const ALL_TEXT_LAYOUTS = '*';

type TextLayoutChangedDetail = { elementId: string };

const textSurfaceCache = new Map<string, HTMLElement>();

export function notifyTextLayoutChanged(elementId: string): void {
  if (
    typeof window === 'undefined' ||
    typeof window.dispatchEvent !== 'function'
  ) return;
  window.dispatchEvent(new CustomEvent<TextLayoutChangedDetail>(
    TEXT_LAYOUT_CHANGED_EVENT,
    { detail: { elementId } },
  ));
}

/**
 * Notify mounted text blocks and arrows after a canvas transform changes.
 * ResizeObserver does not fire for `transform: scale(...)`, so zooming needs
 * an explicit post-layout invalidation to avoid measuring one frame at the
 * previous visual scale.
 */
export function notifyAllTextLayoutsChanged(): void {
  notifyTextLayoutChanged(ALL_TEXT_LAYOUTS);
}

export function subscribeTextLayoutChanged(
  listener: (elementId: string) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<TextLayoutChangedDetail>).detail;
    if (detail?.elementId) listener(detail.elementId);
  };
  window.addEventListener(TEXT_LAYOUT_CHANGED_EVENT, handle);
  return () => window.removeEventListener(TEXT_LAYOUT_CHANGED_EVENT, handle);
}

/**
 * Creates a compact token model for the selected phrase. The model is stored
 * with an arrow as a stable, inspectable identity for every word; visual
 * coordinates are deliberately resolved from the live DOM instead.
 */
export function textWordsForSelection(
  text: string,
  startOffset: number,
  endOffset: number,
  elementId: string,
): TextWordAnchor[] {
  const start = Math.max(0, Math.min(text.length, Math.floor(startOffset)));
  const end = Math.max(start, Math.min(text.length, Math.floor(endOffset)));
  if (end <= start) return [];
  const words: TextWordAnchor[] = [];
  const expression = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text))) {
    const wordStart = match.index;
    const wordEnd = wordStart + match[0].length;
    if (wordEnd <= start) continue;
    if (wordStart >= end) break;
    const word = match[0].slice(0, 160);
    words.push({
      endOffset: wordEnd,
      id: textWordId(elementId, wordStart, wordEnd, word),
      startOffset: wordStart,
      text: word,
    });
    if (words.length >= 128) break;
  }
  return words;
}

/**
 * Measures the current DOM range for an anchor. Returning null is safe for
 * SSR/tests (or an unmounted block); callers retain the persisted fallback
 * until the browser has a measurable layout.
 */
export function measureTextRange(
  root: HTMLElement | undefined,
  anchor: TextRangeAnchor,
  scale = 1,
): TextRangeFrame | null {
  const fragments = measureTextRangeFragments(root, anchor, scale);
  if (!fragments?.length) return null;
  return unionTextRangeFragments(fragments);
}

/**
 * Measures every rendered fragment of a persisted text range. `Range` APIs
 * are not implemented by some WebViews and by jsdom, so the single bounding
 * rectangle is a safe fallback.
 */
export function measureTextRangeFragments(
  root: HTMLElement | undefined,
  anchor: TextRangeAnchor,
  scale = 1,
): TextRangeFragment[] | null {
  if (!root || typeof document === 'undefined') return null;
  const resolved = resolveTextRange(root, anchor);
  if (!resolved) return null;
  let rangeRect: DOMRect | DOMRectReadOnly;
  let blockRect: DOMRect | DOMRectReadOnly;
  let clientRects: ArrayLike<DOMRect | DOMRectReadOnly> | null = null;
  try {
    rangeRect = resolved.range.getBoundingClientRect();
    const block = root.closest<HTMLElement>('.canvas-text-block') ?? root;
    blockRect = block.getBoundingClientRect();
  } catch {
    return null;
  }
  // A few embedded WebViews expose getBoundingClientRect but throw from
  // getClientRects. Keep the reliable bounding box in that case instead of
  // dropping the whole anchor.
  try {
    const getClientRects = resolved.range.getClientRects;
    if (typeof getClientRects === 'function') clientRects = getClientRects.call(resolved.range);
  } catch {
    clientRects = null;
  }
  if (!isFiniteRect(rangeRect) || !isFiniteRect(blockRect)) return null;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const fragments = clientRects
    ? Array.from(clientRects)
        .filter((rect) => isFiniteRect(rect))
        .map((rect) => toLocalTextRangeFrame(rect, blockRect, safeScale))
    : [];
  return fragments.length > 0
    ? dedupeTextRangeFragments(fragments)
    : [toLocalTextRangeFrame(rangeRect, blockRect, safeScale)];
}

/** Measures a mounted canvas text element by its stable data attribute. */
export function measureTextRangeByElementId(
  elementId: string,
  anchor: TextRangeAnchor,
  scale = 1,
): TextRangeFrame | null {
  const surface = findTextSurface(elementId);
  return surface ? measureTextRange(surface, anchor, scale) : null;
}

/** Measures line fragments for a mounted text element by its stable id. */
export function measureTextRangeFragmentsByElementId(
  elementId: string,
  anchor: TextRangeAnchor,
  scale = 1,
): TextRangeFragment[] | null {
  const surface = findTextSurface(elementId);
  return surface ? measureTextRangeFragments(surface, anchor, scale) : null;
}

/**
 * Reads the currently rendered text block dimensions in logical canvas units.
 * During a pointer resize the persisted element still has its previous size;
 * using the DOM box here keeps attached arrows aligned with the live block
 * until the resize is committed.
 */
export function measureTextBlockSizeByElementId(
  elementId: string,
  scale = 1,
): { height: number; width: number } | null {
  const surface = findTextSurface(elementId);
  const block = surface?.closest<HTMLElement>('.canvas-text-block') ?? surface;
  if (!block) return null;
  let rect: DOMRect | DOMRectReadOnly;
  try {
    rect = block.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!isFiniteRect(rect)) return null;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    height: Math.max(1, rect.height / safeScale),
    width: Math.max(1, rect.width / safeScale),
  };
}

/** Resolves a persisted range to current text-node points. */
export function resolveTextRange(
  root: HTMLElement,
  anchor: TextRangeAnchor,
): { endOffset: number; range: Range; startOffset: number } | null {
  const text = root.textContent ?? '';
  if (!text.length) return null;
  const offsets = locateAnchor(text, anchor);
  if (!offsets) return null;
  const start = textPointAtOffset(root, offsets.startOffset);
  const end = textPointAtOffset(root, offsets.endOffset);
  if (!start || !end) return null;
  try {
    const range = root.ownerDocument?.createRange() ?? document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return { ...offsets, range };
  } catch {
    return null;
  }
}

/** Computes a text-node offset for a DOM selection point. */
export function textOffset(
  root: Node,
  target: Node,
  offset: number,
): number | null {
  let total = 0;
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === 3) {
        const limit = node.textContent?.length ?? 0;
        total += Math.max(0, Math.min(offset, limit));
      } else {
        const limit = node.childNodes.length;
        const childOffset = Math.max(0, Math.min(offset, limit));
        for (let index = 0; index < childOffset; index += 1) {
          total += node.childNodes[index]?.textContent?.length ?? 0;
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === 3) {
      total += node.textContent?.length ?? 0;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return found ? total : null;
}

/** Converts a text offset back to a valid DOM point. */
export function textPointAtOffset(
  root: Node,
  offset: number,
): { node: Node; offset: number } | null {
  const documentNode = root.ownerDocument ??
    (typeof document !== 'undefined' ? document : null);
  if (!documentNode) return null;
  const showText = typeof NodeFilter === 'undefined' ? 4 : NodeFilter.SHOW_TEXT;
  const walker = documentNode.createTreeWalker(root, showText);
  let remaining = Math.max(0, offset);
  let lastText: Node | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    lastText = node;
  }
  if (lastText) return { node: lastText, offset: lastText.textContent?.length ?? 0 };
  return { node: root, offset: 0 };
}

function locateAnchor(
  text: string,
  anchor: Pick<TextRangeAnchor, 'endOffset' | 'quote' | 'startOffset' | 'words'>,
): { endOffset: number; startOffset: number } | null {
  const quote = anchor.quote.trim();
  if (!quote) return null;
  const hint = Math.max(0, Math.min(text.length, Math.floor(anchor.startOffset)));
  const exact = nearestSubstringIndex(text, quote, hint);
  if (exact >= 0) {
    return { endOffset: exact + quote.length, startOffset: exact };
  }

  const byWords = locateAnchorWords(text, anchor.words, hint);
  if (byWords) return byWords;

  const normalizedText = normalizeWithMap(text);
  const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
  const normalizedIndex = nearestSubstringIndex(normalizedText.value, normalizedQuote, hint);
  if (normalizedIndex < 0) return null;
  const startOffset = normalizedText.map[normalizedIndex] ?? hint;
  const endMapIndex = normalizedIndex + normalizedQuote.length - 1;
  const endOffset = (normalizedText.map[endMapIndex] ?? startOffset) + 1;
  return { endOffset: Math.max(startOffset + 1, endOffset), startOffset };
}

/**
 * Text edits can invalidate the original phrase (for example a formatter can
 * change whitespace). Word descriptors provide smaller, independently
 * searchable anchors in that case. We only accept a result when at least one
 * word is found and the resulting span is coherent, preventing a false match
 * elsewhere in a document.
 */
function locateAnchorWords(
  text: string,
  words: TextWordAnchor[] | undefined,
  hint: number,
): { endOffset: number; startOffset: number } | null {
  if (!words?.length) return null;
  const resolved: Array<{ endOffset: number; startOffset: number }> = [];
  for (const word of words) {
    const query = word.text.trim();
    if (!query) continue;
    const expected = Math.max(0, Math.min(text.length, Math.floor(word.startOffset)));
    const index = nearestWordIndex(text, query, expected, hint);
    if (index < 0) continue;
    resolved.push({ endOffset: index + query.length, startOffset: index });
  }
  if (!resolved.length) return null;
  const startOffset = Math.min(...resolved.map(({ startOffset }) => startOffset));
  const endOffset = Math.max(...resolved.map(({ endOffset }) => endOffset));
  return endOffset > startOffset ? { endOffset, startOffset } : null;
}

function nearestWordIndex(
  text: string,
  query: string,
  expected: number,
  fallbackHint: number,
): number {
  const expression = new RegExp(`(^|\\s)${escapeRegExp(query)}(?=\\s|$)`, 'g');
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text))) {
    const index = match.index + match[1].length;
    const distance = Math.abs(index - expected);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
      if (distance === 0) break;
    }
  }
  if (nearest >= 0) return nearest;
  return nearestSubstringIndex(text, query, fallbackHint);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nearestSubstringIndex(value: string, query: string, hint: number): number {
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let index = value.indexOf(query);
  while (index >= 0) {
    const distance = Math.abs(index - hint);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
      if (distance === 0) break;
    }
    index = value.indexOf(query, index + 1);
  }
  return nearest;
}

function normalizeWithMap(value: string): { map: number[]; value: string } {
  const map: number[] = [];
  let normalized = '';
  let inWhitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/.test(character)) {
      if (!inWhitespace && normalized.length > 0) {
        normalized += ' ';
        map.push(index);
      }
      inWhitespace = true;
      continue;
    }
    normalized += character;
    map.push(index);
    inWhitespace = false;
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { map, value: normalized };
}

function findTextSurface(elementId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const cached = textSurfaceCache.get(elementId);
  const cachedOwner = cached?.closest<HTMLElement>('[data-canvas-element-id]');
  if (
    cached?.isConnected &&
    cachedOwner?.dataset.canvasElementId === elementId
  ) return cached;
  textSurfaceCache.delete(elementId);
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-canvas-element-id]',
  )) {
    if (element.dataset.canvasElementId !== elementId) continue;
    const surface = element.matches('.canvas-text-surface')
      ? element
      : element.querySelector<HTMLElement>('.canvas-text-surface');
    if (surface) textSurfaceCache.set(elementId, surface);
    return surface;
  }
  return null;
}

function toLocalTextRangeFrame(
  range: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>,
  block: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>,
  scale: number,
): TextRangeFrame {
  const blockWidth = Math.max(1, block.width / scale);
  const blockHeight = Math.max(1, block.height / scale);
  const x = clamp((range.left - block.left) / scale, 0, blockWidth);
  const y = clamp((range.top - block.top) / scale, 0, blockHeight);
  return {
    height: Math.min(Math.max(1, range.height / scale), Math.max(1, blockHeight - y)),
    width: Math.min(Math.max(1, range.width / scale), Math.max(1, blockWidth - x)),
    x,
    y,
  };
}

function unionTextRangeFragments(fragments: readonly TextRangeFragment[]): TextRangeFrame {
  const left = Math.min(...fragments.map((fragment) => fragment.x));
  const top = Math.min(...fragments.map((fragment) => fragment.y));
  const right = Math.max(...fragments.map((fragment) => fragment.x + fragment.width));
  const bottom = Math.max(...fragments.map((fragment) => fragment.y + fragment.height));
  return {
    height: Math.max(1, bottom - top),
    width: Math.max(1, right - left),
    x: left,
    y: top,
  };
}

function dedupeTextRangeFragments(
  fragments: readonly TextRangeFragment[],
): TextRangeFragment[] {
  const seen = new Set<string>();
  return fragments.filter((fragment) => {
    const key = [fragment.x, fragment.y, fragment.width, fragment.height]
      .map((value) => value.toFixed(3))
      .join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFiniteRect(
  rect: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>,
): boolean {
  return Number.isFinite(rect.left) && Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 0 && rect.height > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function textWordId(
  elementId: string,
  startOffset: number,
  endOffset: number,
  text: string,
): string {
  let hash = 2166136261;
  for (const character of `${elementId}:${startOffset}:${endOffset}:${text}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `word-${startOffset}-${endOffset}-${(hash >>> 0).toString(36)}`;
}
