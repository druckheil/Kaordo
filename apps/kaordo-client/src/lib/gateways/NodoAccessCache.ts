import type { NodoAccess } from '../domain/nodo';
import { InFlightRequests } from './InFlightRequests';

/**
 * Reuses a short-lived access ticket across the gateways that may touch the
 * same Nodo during one UI operation. The coordinator response contains both
 * the route and the ticket, so asking for it repeatedly only adds Worker/D1
 * traffic without improving the direct request. The cache is deliberately
 * short and never outlives the ticket's safety window.
 */
export class NodoAccessCache {
  #entries = new Map<string, { access: NodoAccess; expiresAt: number }>();
  readonly #inFlight = new InFlightRequests();

  constructor(private readonly ttlMilliseconds = 15_000) {}

  get(
    nodeId: string,
    request: () => Promise<NodoAccess>,
    forceRefresh = false,
  ): Promise<NodoAccess> {
    // A forced operation (update, rename, policy) must never accidentally
    // join a normal read that started just before it. Keep the rare forced
    // request separate while still coalescing concurrent callers of the same
    // kind.
    const requestKey = `access:${nodeId}:${forceRefresh ? 'force' : 'normal'}`;
    return this.#inFlight.get(requestKey, async () => {
      const current = this.#entries.get(nodeId);
      if (!forceRefresh && current && current.expiresAt > Date.now()) {
        return current.access;
      }
      const access = await request();
      const ticketExpiry = access.expiresAt * 1_000 - 30_000;
      const expiresAt = Math.min(Date.now() + this.ttlMilliseconds, ticketExpiry);
      if (expiresAt > Date.now()) this.#entries.set(nodeId, { access, expiresAt });
      else this.#entries.delete(nodeId);
      return access;
    });
  }

  invalidate(nodeId: string): void {
    this.#entries.delete(nodeId);
  }

  clear(): void {
    this.#entries.clear();
    this.#inFlight.clear();
  }
}
