import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasElement } from '../domain/workspace';
import { ARROW_LIVE_DRAG_EVENT } from './arrowLive';
import { dispatchCanvasLiveMove } from './canvasLive';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canvas live movement', () => {
  it('broadcasts the complete descendant set in one frame', () => {
    const rectangle: CanvasElement = {
      fill: '#ffffff',
      height: 180,
      id: 'rectangle-1',
      radius: 10,
      stroke: '#397565',
      strokeWidth: 2,
      type: 'rectangle',
      width: 240,
      x: 40,
      y: 60,
    };
    const text: CanvasElement = {
      color: '#25332d',
      fontSize: 16,
      height: 48,
      html: 'Nested',
      id: 'text-1',
      parentElementId: rectangle.id,
      textAlign: 'left',
      type: 'text',
      width: 120,
      x: 50,
      y: 70,
    };
    const media: CanvasElement = {
      height: 72,
      id: 'media-1',
      kind: 'image',
      mediaId: 'blob-1',
      mimeType: 'image/png',
      name: 'image.png',
      parentElementId: text.id,
      size: 1,
      type: 'media',
      width: 120,
      x: 50,
      y: 120,
    };
    const received: CustomEvent[] = [];
    const listener = (event: Event) => received.push(event as CustomEvent);
    window.addEventListener(ARROW_LIVE_DRAG_EVENT, listener);

    dispatchCanvasLiveMove(
      { element: rectangle },
      [rectangle, text, media],
      12,
      8,
    );

    window.removeEventListener(ARROW_LIVE_DRAG_EVENT, listener);
    expect(received).toHaveLength(1);
    expect(received[0].detail).toMatchObject({
      deltaX: 12,
      deltaY: 8,
      elementId: rectangle.id,
      phase: 'move',
    });
    expect(received[0].detail.elementIds).toEqual([
      rectangle.id,
      text.id,
      media.id,
    ]);
  });
});
