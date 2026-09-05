import { describe, expect, it } from 'vitest';
import type { ArrowElement, RectangleElement, TextElement } from '../domain/workspace';
import {
  createCanvasSelectionResolver,
  isCanvasElementHighlighted,
} from './canvasSelection';

const source: RectangleElement = {
  fill: '#fff',
  height: 100,
  id: 'source',
  parentObjectId: 'panel-a',
  radius: 8,
  stroke: '#000',
  strokeWidth: 1,
  type: 'rectangle',
  width: 100,
  x: 0,
  y: 0,
};

const arrow: ArrowElement = {
  controlPoints: [],
  endX: 200,
  endY: 0,
  endAttachment: { objectId: 'panel-b', offset: 0.5, side: 'left' },
  headMode: 'end',
  height: 1,
  id: 'arrow',
  startX: 100,
  startY: 0,
  startAttachment: {
    elementId: source.id,
    objectId: 'panel-a',
    offset: 0.5,
    side: 'right',
  },
  stroke: '#397565',
  strokeWidth: 2,
  type: 'arrow',
  lineStyle: 'solid',
  width: 100,
  x: 0,
  y: 0,
};

describe('canvas selection highlighting', () => {
  it('highlights an arrow when its start element is selected', () => {
    expect(isCanvasElementHighlighted(
      arrow,
      [{ kind: 'element', id: source.id }],
      [source, arrow],
    )).toBe(true);
  });

  it('highlights an arrow when its start panel is selected', () => {
    expect(isCanvasElementHighlighted(
      arrow,
      [{ kind: 'panel', id: 'panel-a' }],
      [source, arrow],
    )).toBe(true);
  });

  it('does not assign ownership to the target panel', () => {
    expect(isCanvasElementHighlighted(
      arrow,
      [{ kind: 'panel', id: 'panel-b' }],
      [source, arrow],
    )).toBe(false);
  });

  it('precomputes highlight relationships for a complete render pass', () => {
    const child: TextElement = {
      color: '#25332d',
      fontSize: 16,
      height: 40,
      id: 'child',
      html: '<p>Child</p>',
      parentElementId: source.id,
      parentObjectId: source.parentObjectId,
      textAlign: 'left',
      type: 'text',
      width: 100,
      x: 0,
      y: 0,
    };
    const resolver = createCanvasSelectionResolver(
      [{ kind: 'element', id: source.id }],
      [source, child, arrow],
    );

    expect(resolver.isHighlighted(source)).toBe(true);
    expect(resolver.isHighlighted(child)).toBe(true);
    expect(resolver.isHighlighted(arrow)).toBe(true);
    expect(resolver.ids).toEqual(new Set(['source', 'child']));
  });
});
