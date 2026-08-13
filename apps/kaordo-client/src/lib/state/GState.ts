import type { Director, StateKey } from './Director';
import type { GStateManager } from './GStateManager';

export type AnyGState = GState<any>;
export type SnapshotOf<TState extends AnyGState> =
  TState extends GState<infer TSnapshot> ? TSnapshot : never;

export const G_STATE_HOST: unique symbol = Symbol('kaordo.g-state-host');

export interface GStateHost<TSnapshot> {
  readonly director: Director;
  publishFrom(state: GState<TSnapshot>, snapshot: Readonly<TSnapshot>): void;
}

/** A small lifecycle owner with an immutable, observable snapshot. */
export abstract class GState<TSnapshot> {
  #host: GStateHost<TSnapshot> | null = null;
  #snapshot: Readonly<TSnapshot>;

  protected constructor(initialSnapshot: TSnapshot) {
    this.#snapshot = initialSnapshot;
  }

  get snapshot(): Readonly<TSnapshot> {
    return this.#snapshot;
  }

  /** Called after the state becomes active. */
  enter(): void {}

  /** Called before the state stops being active. */
  exit(): void {}

  /** Replaces the snapshot and synchronously notifies this state's manager. */
  protected publish(snapshot: TSnapshot): void {
    if (Object.is(snapshot, this.#snapshot)) return;

    this.#snapshot = snapshot;
    this.#host?.publishFrom(this, snapshot);
  }

  /** Derives and publishes a snapshot from the current immutable value. */
  protected update(reducer: (current: Readonly<TSnapshot>) => TSnapshot): void {
    this.publish(reducer(this.#snapshot));
  }

  /** Retrieves another registered state manager through the shared Director. */
  protected manager<TState extends AnyGState>(
    key: StateKey<TState>,
  ): GStateManager<TState> {
    return this.requireHost().director.get(key);
  }

  /** Retrieves the active state from another registered state family. */
  protected current<TState extends AnyGState>(key: StateKey<TState>): TState | null {
    return this.requireHost().director.current(key);
  }

  /** @internal Used only by GStateManager lifecycle handoffs. */
  [G_STATE_HOST](host: GStateHost<TSnapshot> | null): void {
    this.#host = host;
  }

  private requireHost(): GStateHost<TSnapshot> {
    if (!this.#host) {
      throw new Error('The state is not active in a state manager.');
    }
    return this.#host;
  }
}
