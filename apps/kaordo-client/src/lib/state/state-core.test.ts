import { describe, expect, it, vi } from 'vitest';
import { Director, StateKey } from './Director';
import { GState } from './GState';

type CounterSnapshot = {
  count: number;
};

class CounterState extends GState<CounterSnapshot> {
  constructor(
    count = 0,
    private readonly events: string[] = [],
    private readonly label = 'counter',
  ) {
    super({ count });
  }

  override enter(): void {
    this.events.push(`${this.label}:enter`);
  }

  override exit(): void {
    this.events.push(`${this.label}:exit`);
  }

  increment(): void {
    this.update((snapshot) => ({ count: snapshot.count + 1 }));
  }
}

describe('state core', () => {
  it('hands lifecycle ownership over in order and ignores the same instance', () => {
    const events: string[] = [];
    const director = new Director();
    const key = new StateKey<CounterState>('counter');
    const manager = director.register(key);
    const first = new CounterState(0, events, 'first');
    const second = new CounterState(0, events, 'second');

    manager.change(first);
    manager.change(first);
    manager.change(second);
    manager.change(null);

    expect(events).toEqual([
      'first:enter',
      'first:exit',
      'second:enter',
      'second:exit',
    ]);
  });

  it('provides synchronous Svelte-readable subscriptions', () => {
    const director = new Director();
    const manager = director.register(new StateKey<CounterState>('counter'));
    const subscriber = vi.fn();
    const unsubscribe = manager.subscribe(subscriber);
    const state = new CounterState();

    expect(subscriber).toHaveBeenLastCalledWith(null);
    manager.change(state);
    expect(subscriber).toHaveBeenLastCalledWith({ count: 0 });
    state.increment();
    expect(subscriber).toHaveBeenLastCalledWith({ count: 1 });

    unsubscribe();
    state.increment();
    expect(subscriber).toHaveBeenCalledTimes(3);
  });

  it('ignores publications from a state after it has been replaced', () => {
    const director = new Director();
    const manager = director.register(new StateKey<CounterState>('counter'));
    const first = new CounterState(4);
    const second = new CounterState(20);
    const subscriber = vi.fn();
    manager.subscribe(subscriber);

    manager.change(first);
    manager.change(second);
    first.increment();

    expect(manager.current).toBe(second);
    expect(manager.snapshot).toEqual({ count: 20 });
    expect(subscriber).toHaveBeenCalledTimes(3);
  });

  it('protects explicit keys from duplicate or missing registration', () => {
    const director = new Director();
    const key = new StateKey<CounterState>('counter');
    const missingKey = new StateKey<CounterState>('missing');
    const manager = director.register(key);

    expect(director.get(key)).toBe(manager);
    expect(() => director.register(key)).toThrow(
      'A state manager for "counter" is already registered.',
    );
    expect(() => director.get(missingKey)).toThrow(
      'The state manager for "missing" is not registered.',
    );
  });

  it('shuts registered state families down in reverse order', () => {
    const events: string[] = [];
    const director = new Director();
    const firstKey = new StateKey<CounterState>('first');
    const secondKey = new StateKey<CounterState>('second');
    const thirdKey = new StateKey<CounterState>('third');
    director.register(firstKey).change(new CounterState(0, events, 'first'));
    director.register(secondKey).change(new CounterState(0, events, 'second'));
    director.register(thirdKey).change(new CounterState(0, events, 'third'));
    events.length = 0;

    director.shutdown();

    expect(events).toEqual(['third:exit', 'second:exit', 'first:exit']);
    expect(() => director.get(firstKey)).toThrow(
      'The state manager for "first" is not registered.',
    );
  });
});
