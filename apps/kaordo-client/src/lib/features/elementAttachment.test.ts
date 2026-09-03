import { describe, expect, it } from 'vitest';
import type { CanvasPlacement } from '../domain/canvas';
import type {
  ArrowElement,
  RectangleElement,
  TextElement,
} from '../domain/workspace';
import { CANVAS_CARD_HEADER_HEIGHT } from './canvas';
import {
  moveTextWithRectangle,
  settleCanvasElement,
  translateAttachedArrowGeometry,
} from './elementAttachment';

const tray: CanvasPlacement = {
  document: { elements: [], version: 1 },
  height: 280,
  id: 'object-1',
  title: 'Object',
  type: 'Knowledge object',
  width: 360,
  x: 300,
  y: 240,
};

const rectangle: RectangleElement = {
  fill: '#ffffff',
  height: 120,
  id: 'rectangle-1',
  parentObjectId: tray.id,
  radius: 10,
  stroke: '#000000',
  strokeWidth: 2,
  type: 'rectangle',
  width: 180,
  x: 30,
  y: 24,
};

const text: TextElement = {
  color: '#111111',
  fontSize: 16,
  height: 48,
  html: 'Text',
  id: 'text-1',
  textAlign: 'left',
  type: 'text',
  width: 120,
  x: 0,
  y: 0,
};

describe('canvas element attachment', () => {
  it('attaches text to a rectangle before its containing object', () => {
    const globalX = tray.x + rectangle.x + 20;
    const globalY = tray.y + CANVAS_CARD_HEADER_HEIGHT + rectangle.y + 18;

    expect(
      settleCanvasElement(
        text,
        globalX,
        globalY,
        [rectangle],
        [tray],
      ),
    ).toMatchObject({
      parentElementId: rectangle.id,
      parentObjectId: tray.id,
      x: rectangle.x + 20,
      y: rectangle.y + 18,
    });
  });

  it('attaches text to the object when no rectangle is underneath', () => {
    const attached = settleCanvasElement(
      text,
      tray.x + 220,
      tray.y + CANVAS_CARD_HEADER_HEIGHT + 150,
      [rectangle],
      [tray],
    );

    expect(attached).toMatchObject({
      parentObjectId: tray.id,
      x: 220,
      y: 150,
    });
    expect(attached).not.toHaveProperty('parentElementId');
  });

  it('moves attached text with its rectangle across object boundaries', () => {
    const attached: TextElement = {
      ...text,
      parentElementId: rectangle.id,
      parentObjectId: tray.id,
      x: 58,
      y: 50,
    };
    const detachedRectangle: RectangleElement = {
      ...rectangle,
      x: 700,
      y: 520,
    };
    delete detachedRectangle.parentObjectId;

    const moved = moveTextWithRectangle(
      attached,
      rectangle,
      detachedRectangle,
    );

    expect(moved).toMatchObject({
      parentElementId: rectangle.id,
      x: 728,
      y: 546,
    });
    expect(moved).not.toHaveProperty('parentObjectId');
  });

  it('translates every control point when an attached element moves', () => {
    const arrow: ArrowElement = {
      controlPoints: [
        { x: 140, y: 80 },
        { x: 190, y: 120 },
      ],
      endX: 280,
      endY: 160,
      endAttachment: {
        offset: 0.5,
        side: 'left',
      },
      headMode: 'end',
      height: 100,
      id: 'arrow-1',
      startX: 100,
      startY: 80,
      startAttachment: {
        elementId: rectangle.id,
        offset: 0.25,
        side: 'right',
      },
      stroke: '#397565',
      strokeWidth: 2,
      type: 'arrow',
      lineStyle: 'solid',
      width: 180,
      x: 100,
      y: 80,
    };

    const moved = translateAttachedArrowGeometry(
      [arrow],
      { elementIds: new Set([rectangle.id]) },
      32,
      18,
    )[0];

    expect(moved).toMatchObject({
      controlPoints: [
        { x: 172, y: 98 },
        { x: 222, y: 138 },
      ],
      startX: 132,
      startY: 98,
      endX: 280,
      endY: 160,
    });
  });

  it('does not translate arrows rendered inside a moved object', () => {
    const arrow: ArrowElement = {
      controlPoints: [{ x: 140, y: 80 }, { x: 190, y: 120 }],
      endX: 280,
      endY: 160,
      headMode: 'end',
      height: 100,
      id: 'nested-arrow-1',
      parentObjectId: tray.id,
      startX: 100,
      startY: 80,
      startAttachment: {
        objectId: tray.id,
        offset: 0.25,
        side: 'right',
      },
      stroke: '#397565',
      strokeWidth: 2,
      type: 'arrow',
      lineStyle: 'solid',
      width: 180,
      x: 100,
      y: 80,
    };

    const moved = translateAttachedArrowGeometry(
      [arrow],
      {
        elementIds: new Set([rectangle.id]),
        excludeParentObjectId: tray.id,
        objectId: tray.id,
      },
      32,
      18,
    )[0];

    expect(moved).toBe(arrow);
  });
});
