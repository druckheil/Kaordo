/**
 * Shares concurrent reads without turning them into a time-based cache.
 *
 * A request is removed as soon as it settles, so an explicit refresh always
 * reaches the source again while simultaneous consumers still use one call.
 */
export class InFlightRequests {
  readonly #requests = new Map<string, Promise<unknown>>();

  get<T>(key: string, request: () => Promise<T>): Promise<T> {
    const existing = this.#requests.get(key);
    if (existing) return existing as Promise<T>;

    // Gateway adapters are expected to return a promise, but a synchronous
    // validation/IPC failure must still clear the slot instead of escaping
    // before the request can be shared or cleaned up.
    let started: Promise<T>;
    try {
      started = Promise.resolve(request());
    } catch (error) {
      started = Promise.reject(error);
    }
    let shared: Promise<T>;
    shared = started.finally(() => {
      if (this.#requests.get(key) === shared) this.#requests.delete(key);
    });
    this.#requests.set(key, shared);
    return shared;
  }

  clear(): void {
    this.#requests.clear();
  }
}
