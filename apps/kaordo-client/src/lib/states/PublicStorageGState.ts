import type { PublicNodoStorage } from '../domain/nodo';
import type { NodoGateway } from '../gateways/NodoGateway';
import { GState } from '../state/GState';

export type PublicStorageSnapshot = {
  error: string | null;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  storage: PublicNodoStorage | null;
};

const PUBLIC_STORAGE_CACHE_MS = 15_000;

/** Loads the shared Public Nodo pool independently from the Fluo feed. */
export class PublicStorageGState extends GState<PublicStorageSnapshot> {
  readonly #gateway: NodoGateway;
  #requestId = 0;
  #lastRefreshAt = 0;
  #refreshInFlight: Promise<void> | null = null;

  constructor(gateway: NodoGateway) {
    super({ error: null, phase: 'idle', storage: null });
    this.#gateway = gateway;
  }

  override enter(): void {
    void this.refresh();
  }

  override exit(): void {
    this.#requestId += 1;
    this.#refreshInFlight = null;
  }

  reset(): void {
    this.#requestId += 1;
    this.#lastRefreshAt = 0;
    this.#refreshInFlight = null;
    this.publish({ error: null, phase: 'idle', storage: null });
  }

  refresh(force = false): Promise<void> {
    // Profile, Fluo, and storage-management views can all request the same
    // public pool during a section transition. Share that in-flight read so
    // the coordinator sees one request instead of a burst of identical ones.
    if (this.#refreshInFlight) return this.#refreshInFlight;
    if (
      !force && this.snapshot.phase === 'ready' && this.snapshot.storage &&
      Date.now() - this.#lastRefreshAt < PUBLIC_STORAGE_CACHE_MS
    ) return Promise.resolve();
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null, phase: 'loading' });
    let refresh: Promise<void>;
    refresh = (async () => {
      try {
        const storage = await this.#gateway.publicStorage();
        if (requestId !== this.#requestId) return;
        this.#lastRefreshAt = Date.now();
        this.publish({ error: null, phase: 'ready', storage });
      } catch (error) {
        if (requestId !== this.#requestId) return;
        this.publish({
          ...this.snapshot,
          error: readableError(error),
          phase: 'error',
        });
      }
    })().finally(() => {
      if (this.#refreshInFlight === refresh) this.#refreshInFlight = null;
    });
    this.#refreshInFlight = refresh;
    return refresh;
  }
}

function readableError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Public Nodo storage is unavailable.';
}
