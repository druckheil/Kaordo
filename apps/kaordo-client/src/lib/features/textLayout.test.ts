import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextRangeAnchor } from '../domain/workspace';
import {
  measureTextRange,
  measureTextRangeByElementId,
  measureTextRangeFragments,
  resolveTextRange,
  textWordsForSelection,
} from './textLayout';

const anchor: TextRangeAnchor = {
  endOffset: 11,
  height: 18,
  quote: 'hello world',
  startOffset: 0,
  width: 84,
  x: 4,
  y: 2,
};

afterEach(() => {
  document.body.replaceChildren();
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  vi.restoreAllMocks();
});

describe('text layout anchors', () => {
  it('creates one uniquely identified token for each selected word', () => {
    expect(textWordsForSelection('hello world again', 0, 11, 'text-1')).toEqual([
      {
        endOffset: 5,
        id: expect.stringMatching(/^word-/),
        startOffset: 0,
        text: 'hello',
      },
      {
        endOffset: 11,
        id: expect.stringMatching(/^word-/),
        startOffset: 6,
        text: 'world',
      },
    ]);
    const words = textWordsForSelection('hello world again', 0, 11, 'text-1');
    expect(words[0]?.id).not.toBe(words[1]?.id);
  });

  it('measures the current DOM range instead of the persisted box', () => {
    const block = document.createElement('div');
    block.className = 'canvas-text-block';
    const surface = document.createElement('div');
    surface.className = 'canvas-text-surface';
    surface.textContent = 'hello world';
    block.append(surface);
    document.body.append(block);
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 236,
        height: 20,
        left: 130,
        right: 250,
        top: 216,
        width: 120,
      }),
    });
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
      bottom: 280,
      height: 80,
      left: 100,
      right: 500,
      top: 200,
      width: 400,
    } as DOMRect);

    expect(measureTextRange(surface, anchor, 2)).toEqual({
      height: 10,
      width: 60,
      x: 15,
      y: 8,
    });
    expect(measureTextRangeByElementId('missing', anchor, 1)).toBeNull();
    surface.dataset.canvasElementId = 'text-1';
    expect(measureTextRangeByElementId('text-1', anchor, 2)).toEqual({
      height: 10,
      width: 60,
      x: 15,
      y: 8,
    });
  });

  it('keeps wrapped line fragments separate when the browser exposes them', () => {
    const block = document.createElement('div');
    block.className = 'canvas-text-block';
    const surface = document.createElement('div');
    surface.className = 'canvas-text-surface';
    surface.textContent = 'hello world';
    block.append(surface);
    document.body.append(block);
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 240,
        height: 44,
        left: 120,
        right: 300,
        top: 196,
        width: 180,
      }),
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [
        { bottom: 214, height: 18, left: 120, right: 180, top: 196, width: 60 },
        { bottom: 240, height: 18, left: 120, right: 300, top: 222, width: 180 },
      ],
    });
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
      bottom: 280,
      height: 84,
      left: 100,
      right: 500,
      top: 180,
      width: 400,
    } as DOMRect);

    expect(measureTextRangeFragments(surface, anchor, 2)).toEqual([
      { height: 9, width: 30, x: 10, y: 8 },
      { height: 9, width: 90, x: 10, y: 21 },
    ]);
    expect(measureTextRange(surface, anchor, 2)).toEqual({
      height: 22,
      width: 90,
      x: 10,
      y: 8,
    });
  });

  it('falls back to word descriptors after whitespace or markup changes', () => {
    const block = document.createElement('div');
    block.className = 'canvas-text-block';
    const surface = document.createElement('div');
    surface.className = 'canvas-text-surface';
    surface.textContent = 'hello   world';
    block.append(surface);
    document.body.append(block);
    const wordAnchor: TextRangeAnchor = {
      ...anchor,
      endOffset: 11,
      quote: 'hello world!',
      words: [
        { endOffset: 5, id: 'word-hello', startOffset: 0, text: 'hello' },
        { endOffset: 11, id: 'word-world', startOffset: 6, text: 'world' },
      ],
    };
    const resolved = resolveTextRange(surface, wordAnchor);
    expect(resolved?.startOffset).toBe(0);
    expect(resolved?.endOffset).toBe(13);
  });
});
