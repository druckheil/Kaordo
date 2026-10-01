import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaFrameHeightPx, mediaFrameRatio } from '../packages/media-ui/src/media-layout.ts';

test('a single image reserves its final height from stored dimensions', () => {
  assert.equal(mediaFrameHeightPx([{ width: 1200, height: 900 }], 600), 450);
  assert.equal(mediaFrameHeightPx([{ width: 1200, height: 900 }], 900), 544);
});

test('a strip of portrait images shares the viewport without slide-sized blanks', () => {
  const media = [{ width: 600, height: 1200 }, { width: 600, height: 1200 }];
  assert.equal(mediaFrameHeightPx(media, 500), 500);
  assert.equal(mediaFrameHeightPx(media, 1200), 544);
});

test('extreme dimensions are cropped to the supported frame ratio', () => {
  assert.equal(mediaFrameRatio({ width: 100, height: 1000 }), 0.5);
  assert.equal(mediaFrameRatio({ width: 1000, height: 100 }), 2);
  assert.equal(mediaFrameHeightPx([{ width: 100, height: 1000 }], 500), 544);
});
