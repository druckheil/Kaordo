import { describe, expect, it, vi } from 'vitest';
import { dispatchArrowLiveDrag, subscribeArrowLiveDrag } from './arrowLive';

describe('indexed arrow live movement', () => {
  it('notifies only arrows affected by the moved target', () => {
    const affected = vi.fn();
    const unrelated = vi.fn();
    const stopAffected = subscribeArrowLiveDrag(
      { elementIds: ['element-a'] },
      affected,
    );
    const stopUnrelated = subscribeArrowLiveDrag(
      { elementIds: ['element-b'] },
      unrelated,
    );

    dispatchArrowLiveDrag({
      deltaX: 12,
      deltaY: 8,
      elementId: 'element-a',
      phase: 'move',
    });

    expect(affected).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
    stopAffected();
    stopUnrelated();
  });
});
