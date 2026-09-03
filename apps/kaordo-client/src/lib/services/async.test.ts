import { describe, expect, it } from 'vitest';
import { allSettledConcurrent, mapConcurrent } from './async';

describe('bounded async helpers', () => {
  it('preserves order while limiting active work', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapConcurrent([40, 10, 20, 0], 2, async (delay, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return `${index}:${delay}`;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(result).toEqual(['0:40', '1:10', '2:20', '3:0']);
  });

  it('settles each item independently and preserves input order', async () => {
    const result = await allSettledConcurrent([1, 2, 3], 1, async (value) => {
      if (value === 2) throw new Error('expected failure');
      return value * 2;
    });

    expect(result).toEqual([
      { status: 'fulfilled', value: 2 },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: 6 },
    ]);
  });
});
