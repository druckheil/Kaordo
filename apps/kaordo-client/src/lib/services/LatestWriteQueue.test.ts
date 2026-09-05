import { describe, expect, it } from 'vitest';
import { LatestWriteQueue } from './LatestWriteQueue';

describe('LatestWriteQueue', () => {
  it('keeps only the newest pending snapshot', async () => {
    const writes: string[] = [];
    let releaseFirst!: () => void;
    const queue = new LatestWriteQueue<string>(
      async (value) => {
        writes.push(value);
        if (value === 'first') {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
      },
    );

    const first = queue.enqueue('first');
    const superseded = queue.enqueue('second');
    const latest = queue.enqueue('latest');
    expect(writes).toEqual(['first']);

    releaseFirst();
    await queue.drain();
    await Promise.all([first, superseded, latest]);
    expect(writes).toEqual(['first', 'latest']);
  });

  it('shares waiters for equal snapshots', async () => {
    let writes = 0;
    const queue = new LatestWriteQueue<{ value: number }>(
      async () => { writes += 1; },
      { equals: (left, right) => left.value === right.value },
    );

    await Promise.all([
      queue.enqueue({ value: 7 }),
      queue.enqueue({ value: 7 }),
    ]);
    expect(writes).toBe(1);
  });

  it('rejects a failed batch without stranding the queue', async () => {
    const writes: number[] = [];
    const queue = new LatestWriteQueue<number>(async (value) => {
      writes.push(value);
      if (value === 1) throw new Error('write failed');
    });

    const failed = queue.enqueue(1);
    const next = queue.enqueue(2);
    await expect(failed).rejects.toThrow('write failed');
    await expect(next).resolves.toBeUndefined();
    expect(writes).toEqual([1, 2]);
    expect(queue.hasWork).toBe(false);
  });
});
