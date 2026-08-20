import type { PublicNodoStorage } from '../domain/nodo';
import type { NodoGateway } from '../gateways/NodoGateway';
import { GState } from '../state/GState';

export type PublicStorageSnapshot = {
  error: string | null;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  storage: PublicNodoStorage | null;
};

/** Loads the shared Public Nodo pool independently from the Fluo feed. */
export class PublicStorageGState extends GState<PublicStorageSnapshot> {
  readonly #gateway: NodoGateway;
  #requestId = 0;

  constructor(gateway: NodoGateway) {
    super({ error: null, phase: 'idle', storage: null });
    this.#gateway = gateway;
  }

  override enter(): void {
    void this.refresh();
  }

  override exit(): void {
    this.#requestId += 1;
  }

  reset(): void {
    this.#requestId += 1;
    this.publish({ error: null, phase: 'idle', storage: null });
  }

  async refresh(): Promise<void> {
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null, phase: 'loading' });
    try {
      const storage = await this.#gateway.publicStorage();
      if (requestId !== this.#requestId) return;
      this.publish({ error: null, phase: 'ready', storage });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({
        ...this.snapshot,
        error: readableError(error),
        phase: 'error',
      });
    }
  }
}

function readableError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Public Nodo storage is unavailable.';
}
