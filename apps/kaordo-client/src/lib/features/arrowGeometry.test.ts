import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasPlacement } from '../domain/canvas';
import type {
  ArrowElement,
  RectangleElement,
  TextElement,
  TextRangeAnchor,
} from '../domain/workspace';
import {
  arrowPoints,
  canvasTextRangeFrame,
  textRangeAnchorPoint,
  textRangeSide,
} from './arrowGeometry';
import { CANVAS_CARD_HEADER_HEIGHT } from './canvas';

const placement: CanvasPlacement = {
  document: { elements: [], version: 1 },
  height: 320,
  id: 'panel-1',
  title: 'Vocabulary',
  type: 'Knowledge object',
  width: 420,
  x: 100,
  y: 200,
};

const text: TextElement = {
  color: '#25332d',
  fontSize: 16,
  height: 96,
  html: '<p>verringern</p>',
  id: 'text-1',
  parentObjectId: placement.id,
  textAlign: 'left',
  type: 'text',
  width: 220,
  x: 24,
  y: 36,
};

const range: TextRangeAnchor = {
  endOffset: 10,
  height: 22,
  quote: 'verringern',
  startOffset: 0,
  width: 92,
  x: 12,
  y: 8,
};

describe('text explanation arrow geometry', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
    vi.restoreAllMocks();
  });

  it('resolves a phrase box in global and panel-local coordinates', () => {
    expect(canvasTextRangeFrame(text, range, undefined, [placement])).toEqual({
      bottom: placement.y + CANVAS_CARD_HEADER_HEIGHT + text.y + range.y + range.height,
      left: placement.x + text.x + range.x,
      right: placement.x + text.x + range.x + range.width,
      top: placement.y + CANVAS_CARD_HEADER_HEIGHT + text.y + range.y,
    });
    expect(canvasTextRangeFrame(text, range, placement.id, [placement])).toEqual({
      bottom: text.y + range.y + range.height,
      left: text.x + range.x,
      right: text.x + range.x + range.width,
      top: text.y + range.y,
    });
  });

  it('chooses the closest side for an explanation target', () => {
    const frame = canvasTextRangeFrame(text, range, placement.id, [placement]);
    expect(frame).not.toBeNull();
    if (!frame) return;
    expect(textRangeSide(frame, { x: frame.right + 80, y: frame.top })).toBe('right');
    expect(textRangeSide(frame, { x: frame.left - 80, y: frame.top })).toBe('left');
    expect(textRangeSide(frame, { x: frame.left, y: frame.bottom + 80 })).toBe('bottom');
    expect(textRangeSide(frame, { x: frame.left, y: frame.top - 80 })).toBe('top');
  });

  it('keeps the persisted text range as the arrow start anchor', () => {
    const target: RectangleElement = {
      fill: '#dcece5',
      height: 80,
      id: 'card-1',
      parentObjectId: placement.id,
      radius: 10,
      stroke: '#397565',
      strokeWidth: 2,
      type: 'rectangle',
      width: 120,
      x: 250,
      y: 42,
    };
    const arrow: ArrowElement = {
      controlPoints: [{ x: 170, y: 90 }],
      endAttachment: { elementId: target.id, offset: 0.5, side: 'left' },
      endX: 250,
      endY: 82,
      headMode: 'end',
      height: 20,
      id: 'arrow-1',
      parentObjectId: placement.id,
      startAttachment: {
        elementId: text.id,
        objectId: placement.id,
        offset: 0.5,
        side: 'right',
        textRange: range,
      },
      startX: 128,
      startY: 70,
      stroke: '#397565',
      strokeWidth: 2.5,
      type: 'arrow',
      lineStyle: 'solid',
      width: 122,
      x: 128,
      y: 70,
    };
    const points = arrowPoints(arrow, [text, target], [placement]);
    expect(points.start).toEqual({
      x: text.x + range.x + range.width,
      y: text.y + range.y + range.height / 2,
    });
    expect(points.end).toEqual({
      x: target.x,
      y: target.y + target.height / 2,
    });
  });

  it('anchors to the nearest wrapped fragment without leaving the selection', () => {
    const fragments = [
      { bottom: 18, left: 10, right: 70, top: 0 },
      { bottom: 42, left: 10, right: 170, top: 24 },
    ];
    expect(textRangeAnchorPoint(fragments, {
      elementId: text.id,
      offset: 0.84,
      side: 'right',
    })).toEqual({ x: 170, y: 35.28 });
  });

  it('prefers live DOM geometry after the text block is resized', () => {
    const block = document.createElement('div');
    block.className = 'canvas-text-block';
    const surface = document.createElement('div');
    surface.className = 'canvas-text-surface';
    surface.dataset.canvasElementId = text.id;
    surface.textContent = 'verringern';
    block.append(surface);
    document.body.append(block);
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 264,
        height: 24,
        left: 148,
        right: 268,
        top: 240,
        width: 120,
      }),
    });
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
      bottom: 320,
      height: 80,
      left: 100,
      right: 500,
      top: 200,
      width: 400,
    } as DOMRect);

    expect(canvasTextRangeFrame(text, range, placement.id, [placement], 2)).toEqual({
      bottom: text.y + 20 + 12,
      left: text.x + 24,
      right: text.x + 24 + 60,
      top: text.y + 20,
    });
  });
});
