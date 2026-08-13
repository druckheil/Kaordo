import type { Director } from './Director';
import {
  G_STATE_HOST,
  type AnyGState,
  type GState,
  type GStateHost,
  type SnapshotOf,
} from './GState';

export type StateSubscriber<TState extends AnyGState> = (
  snapshot: Readonly<SnapshotOf<TState>> | null,
) => void;

export type Unsubscribe = () => void;

/** Owns zero or one active state and exposes its snapshot as a Svelte-readable store. */
export class GStateManager<TState extends AnyGState>
  implements GStateHost<SnapshotOf<TState>>
{
  readonly #subscribers = new Set<StateSubscriber<TState>>();
  #current: TState | null = null;
  #isChanging = false;
  #snapshot: Readonly<SnapshotOf<TState>> | null = null;

  constructor(readonly director: Director) {}

  get current(): TState | null {
    return this.#current;
  }

  get snapshot(): Readonly<SnapshotOf<TState>> | null {
    return this.#snapshot;
  }

  change(next: TState | null): void {
    if (Object.is(this.#current, next)) return;

    const previous = this.#current;
    this.#isChanging = true;
    try {
      previous?.exit();
      previous?.[G_STATE_HOST](null);

      this.#current = next;
      this.#snapshot = next?.snapshot ?? null;

      if (next) {
        next[G_STATE_HOST](this);
        next.enter();
      }
    } finally {
      this.#snapshot = this.#current?.snapshot ?? null;
      this.#isChanging = false;
      this.emit();
    }
  }

  subscribe(run: StateSubscriber<TState>): Unsubscribe {
    this.#subscribers.add(run);
    run(this.#snapshot);
    return () => {
      this.#subscribers.delete(run);
    };
  }

  shutdown(): void {
    this.change(null);
  }

  /** @internal Accepts updates only from the currently active state. */
  publishFrom(
    state: GState<SnapshotOf<TState>>,
    snapshot: Readonly<SnapshotOf<TState>>,
  ): void {
    if (state !== this.#current || Object.is(snapshot, this.#snapshot)) return;

    this.#snapshot = snapshot;
    if (!this.#isChanging) this.emit();
  }

  private emit(): void {
    for (const subscriber of [...this.#subscribers]) {
      subscriber(this.#snapshot);
    }
  }
}
