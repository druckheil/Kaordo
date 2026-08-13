import { describe, expect, it } from 'vitest';
import {
  continueRectangleDraw,
  isRectangleDrawValid,
  rectangleGeometry,
  startRectangleDraw,
} from './rectangleDrawing';

const options = {
  boundsHeight: 600,
  boundsWidth: 800,
  clickHeight: 90,
  clickWidth: 140,
};

describe('rectangle drawing geometry', () => {
  it('creates the standard centered rectangle for a click', () => {
    const draw = startRectangleDraw({ x: 400, y: 300 }, 1);

    expect(isRectangleDrawValid(draw)).toBe(true);
    expect(rectangleGeometry(draw, options)).toEqual({
      height: 90,
      width: 140,
      x: 330,
      y: 255,
    });
  });

  it('tracks both drag axes exactly without minimum-size substitution', () => {
    const draw = continueRectangleDraw(
      startRectangleDraw({ x: 300, y: 260 }, 1),
      { x: 280, y: 360 },
    );

    expect(draw.dragged).toBe(true);
    expect(isRectangleDrawValid(draw)).toBe(false);
    expect(rectangleGeometry(draw, options)).toEqual({
      height: 100,
      width: 20,
      x: 280,
      y: 260,
    });
  });

  it('keeps an undersized returned drag invalid instead of turning it into a click', () => {
    const started = startRectangleDraw({ x: 200, y: 180 }, 1);
    const dragged = continueRectangleDraw(started, { x: 280, y: 240 });
    const returned = continueRectangleDraw(dragged, { x: 202, y: 181 });

    expect(returned.dragged).toBe(true);
    expect(isRectangleDrawValid(returned)).toBe(false);
    expect(rectangleGeometry(returned, options)).toMatchObject({
      height: 1,
      width: 2,
    });
  });
});
