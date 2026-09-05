import { describe, expect, it } from 'vitest';
import type {
  ArrowElement,
  RectangleElement,
  TextElement,
} from '../domain/workspace';
import {
  contentHierarchyParentFor,
  contentNodeKeyFor,
  contentParentKeyFor,
  createContentHierarchyResolver,
} from './contentHierarchy';

const panelIds = new Set(['panel-a', 'panel-b']);

const cardA: RectangleElement = {
  fill: '#fff',
  height: 120,
  id: 'card-a',
  parentObjectId: 'panel-a',
  radius: 12,
  stroke: '#000',
  strokeWidth: 1,
  type: 'rectangle',
  width: 180,
  x: 0,
  y: 0,
};

const cardB: RectangleElement = {
  ...cardA,
  id: 'card-b',
  parentObjectId: 'panel-b',
};

function arrow(overrides: Partial<ArrowElement> = {}): ArrowElement {
  return {
    controlPoints: [],
    endX: 220,
    endY: 40,
    headMode: 'end',
    height: 40,
    id: 'arrow-1',
    startX: 20,
    startY: 40,
    stroke: '#397565',
    strokeWidth: 2,
    type: 'arrow',
    lineStyle: 'solid',
    width: 200,
    x: 0,
    y: 0,
    ...overrides,
  };
}

describe('Klaro Contents hierarchy', () => {
  it('uses the start element as the owner for a cross-panel arrow', () => {
    const source = {
      elementId: cardA.id,
      objectId: 'panel-a',
      offset: 0.5,
      side: 'right' as const,
    };
    const target = {
      elementId: cardB.id,
      objectId: 'panel-b',
      offset: 0.5,
      side: 'left' as const,
    };
    const element = arrow({
      endAttachment: target,
      parentObjectId: 'panel-b',
      startAttachment: source,
    });

    expect(contentHierarchyParentFor(element, [cardA, cardB, element], panelIds))
      .toEqual({ id: cardA.id, kind: 'element' });
  });

  it('uses the start panel when an arrow starts on a panel', () => {
    const element = arrow({
      endAttachment: { objectId: 'panel-b', offset: 0.5, side: 'left' },
      parentObjectId: 'panel-b',
      startAttachment: { objectId: 'panel-a', offset: 0.5, side: 'right' },
    });

    const resolveParent = createContentHierarchyResolver([element], panelIds);
    expect(resolveParent(element)).toEqual({ id: 'panel-a', kind: 'panel' });
  });

  it('falls back to the persisted panel for an unattached arrow', () => {
    const element = arrow({ parentObjectId: 'panel-b' });
    expect(contentHierarchyParentFor(element, [element], panelIds))
      .toEqual({ id: 'panel-b', kind: 'panel' });
  });

  it('keeps explicit text parents and converts them to stable node keys', () => {
    const text: TextElement = {
      color: '#111',
      fontSize: 16,
      height: 32,
      html: 'Text',
      id: 'text-a',
      parentElementId: cardA.id,
      parentObjectId: cardA.parentObjectId,
      textAlign: 'left',
      type: 'text',
      width: 120,
      x: 0,
      y: 0,
    };

    const parent = contentHierarchyParentFor(text, [cardA, text], panelIds);
    expect(contentParentKeyFor(parent, new Map([
      [cardA.id, contentNodeKeyFor(cardA)],
      [text.id, contentNodeKeyFor(text)],
    ]))).toBe('card:card-a');
  });
});
