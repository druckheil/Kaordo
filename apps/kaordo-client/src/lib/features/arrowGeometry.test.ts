import { describe, expect, it } from 'vitest';
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
});
