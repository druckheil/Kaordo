type WriteWaiter = {
  reject: (reason?: unknown) => void;
  resolve: () => void;
};

type WriteBatch<T> = {
  errorHandlers: Array<(error: unknown) => void>;
  value: T;
  waiters: WriteWaiter[];
};

export type LatestWriteQueueOptions<T> = {
  equals?: (left: T, right: T) => boolean;
  onIdle?: () => void;
};

/**
 * Serializes writes while retaining only the newest queued snapshot.
 *
 * Editors can emit many snapshots while a previous write is still in flight.
 * Sending every intermediate value wastes storage requests and can make an
 * older response overwrite newer state. This queue shares waiters for equal
 * snapshots and lets a newer pending snapshot supersede older queued values.
 */
export class LatestWriteQueue<T> {
  readonly #equals: (left: T, right: T) => boolean;
  readonly #onIdle: (() => void) | undefined;
  readonly #write: (value: T) => Promise<void>;
  #active: WriteBatch<T> | null = null;
  #drain: Promise<void> | null = null;
  #pending: WriteBatch<T> | null = null;

  constructor(
    write: (value: T) => Promise<void>,
    options: LatestWriteQueueOptions<T> = {},
  ) {
    this.#write = write;
    this.#equals = options.equals ?? Object.is;
    this.#onIdle = options.onIdle;
  }

  get hasActive(): boolean {
    return this.#active !== null;
  }

  get hasPending(): boolean {
    return this.#pending !== null;
  }

  get hasWork(): boolean {
    return this.#active !== null || this.#pending !== null || this.#drain !== null;
  }

  enqueue(value: T, onError?: (error: unknown) => void): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      const waiter = { reject, resolve };
      const active = this.#active;
      if (active && this.#equals(active.value, value)) {
        active.waiters.push(waiter);
        if (onError) active.errorHandlers.push(onError);
        return;
      }

      const pending = this.#pending;
      if (pending && this.#equals(pending.value, value)) {
        pending.waiters.push(waiter);
        if (onError) pending.errorHandlers.push(onError);
        return;
      }

      this.#pending = {
        errorHandlers: onError ? [onError] : [],
        value,
        // A newer snapshot contains all changes represented by the previous
        // pending snapshot, so its callers can share the newer write.
        waiters: [
          ...(pending?.waiters ?? []),
          waiter,
        ],
      };
      if (pending?.errorHandlers.length) {
        this.#pending.errorHandlers.unshift(...pending.errorHandlers);
      }
    });

    this.startDrain();
    return promise;
  }

  /** Reject queued-but-not-started writes, preserving an active write. */
  cancelPending(reason: unknown): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    rejectWaiters(pending.waiters, reason);
  }

  /** Waits until both the active and newest pending snapshots are settled. */
  async drain(): Promise<void> {
    while (this.#drain) {
      await this.#drain;
    }
  }

  private startDrain(): void {
    if (this.#drain) return;

    const run = async (): Promise<void> => {
      while (this.#pending) {
        const batch = this.#pending;
        this.#pending = null;
        this.#active = batch;
        try {
          await this.#write(batch.value);
          resolveWaiters(batch.waiters);
        } catch (error) {
          for (const handler of batch.errorHandlers) {
            try {
              handler(error);
            } catch {
              // A caller's rollback/notification hook is best effort.
            }
          }
          rejectWaiters(batch.waiters, error);
        } finally {
          this.#active = null;
        }
      }
    };

    const drain = run().finally(() => {
      if (this.#drain !== drain) return;
      this.#drain = null;
      // An enqueue can happen from a promise continuation immediately after
      // the loop observes an empty queue. Start a fresh drain if needed.
      if (this.#pending) this.startDrain();
      else {
        try {
          this.#onIdle?.();
        } catch {
          // Queue lifecycle callbacks are bookkeeping only; they must not
          // turn a successful write into an unhandled rejection.
        }
      }
    });
    this.#drain = drain;
  }
}

function resolveWaiters(waiters: readonly WriteWaiter[]): void {
  waiters.forEach(({ resolve }) => resolve());
}

function rejectWaiters(
  waiters: readonly WriteWaiter[],
  reason: unknown,
): void {
  waiters.forEach(({ reject }) => reject(reason));
}
