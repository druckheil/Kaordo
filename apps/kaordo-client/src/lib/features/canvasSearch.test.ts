import { describe, expect, it } from 'vitest';
import type {
  ArrowElement,
  RectangleElement,
  TextElement,
  WorkspaceDetail,
} from '../domain/workspace';
import { searchCanvasContent } from './canvasSearch';

const workspace: WorkspaceDetail = {
  id: 'workspace-1',
  name: 'Research',
  objects: [
    {
      document: { elements: [], version: 1 },
      id: 'panel-1',
      title: 'German vocabulary',
      type: 'Knowledge object',
    },
  ],
  path: '/Research.vdw',
  warnings: [],
};

const text: TextElement = {
  color: '#111',
  fontSize: 16,
  height: 32,
  html: '<p>Important <strong>vocabulary</strong></p>',
  id: 'text-1',
  parentObjectId: 'panel-1',
  textAlign: 'left',
  type: 'text',
  width: 160,
  x: 0,
  y: 0,
};

const card: RectangleElement = {
  fill: '#fff',
  height: 120,
  id: 'card-1',
  parentObjectId: 'panel-1',
  radius: 12,
  stroke: '#000',
  strokeWidth: 1,
  type: 'rectangle',
  width: 180,
  x: 0,
  y: 0,
};

const explanationArrow: ArrowElement = {
  controlPoints: [],
  endX: 220,
  endY: 40,
  endAttachment: { objectId: 'panel-1', offset: 0.5, side: 'left' },
  headMode: 'end',
  height: 40,
  id: 'arrow-1',
  startX: 20,
  startY: 40,
  startAttachment: {
    elementId: text.id,
    objectId: 'panel-1',
    offset: 0.5,
    side: 'right',
    textRange: {
      endOffset: 18,
      height: 20,
      quote: 'vocabulary',
      startOffset: 8,
      width: 84,
      x: 30,
      y: 4,
    },
  },
  stroke: '#397565',
  strokeWidth: 2,
  type: 'arrow',
  lineStyle: 'solid',
  width: 200,
  x: 0,
  y: 0,
};

describe('Klaro canvas search', () => {
  it('finds panel titles and text content locally', () => {
    expect(searchCanvasContent(workspace, [text], 'german')[0]).toMatchObject({
      kind: 'panel',
      label: 'German vocabulary',
    });
    expect(searchCanvasContent(workspace, [text], 'knowledge object')[0]).toMatchObject({
      kind: 'panel',
      label: 'German vocabulary',
    });
    expect(searchCanvasContent(workspace, [text], 'important')[0]).toMatchObject({
      element: text,
      kind: 'element',
      label: 'Important vocabulary',
    });

    const longText: TextElement = {
      ...text,
      html: `<p>${'word '.repeat(20)}needle</p>`,
      id: 'long-text',
    };
    expect(searchCanvasContent(workspace, [longText], 'needle')[0]).toMatchObject({
      element: longText,
    });
  });

  it('keeps card numbering independent of non-card elements', () => {
    expect(searchCanvasContent(workspace, [text, card], 'card')[0]).toMatchObject({
      label: 'Card 1',
      element: card,
    });
  });

  it('finds an explanation arrow by its source phrase', () => {
    const phraseResults = searchCanvasContent(workspace, [text, explanationArrow], 'vocabulary');
    expect(phraseResults.find((result) =>
      result.kind === 'element' && result.element.id === text.id,
    ))
      .toMatchObject({
        element: text,
        label: 'Important vocabulary',
      });
    expect(phraseResults.find((result) =>
      result.kind === 'element' && result.element.id === explanationArrow.id,
    ))
      .toMatchObject({
        element: explanationArrow,
        label: 'Arrow',
      });
  });
});
