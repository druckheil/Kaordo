import type { NodoNode } from '../domain/nodo';

export type NodoRegistrySubscriber = (nodes: readonly NodoNode[]) => void;

/** One in-memory source of truth shared by Nodo management and Fluo. */
export class NodoRegistry {
  readonly #removedAtLastSeen = new Map<string, number>();
  readonly #subscribers = new Set<NodoRegistrySubscriber>();
  #nodes: NodoNode[] = [];

  get nodes(): readonly NodoNode[] { return this.#nodes; }

  replace(nodes: readonly NodoNode[]): void {
    this.#nodes = deduplicate(nodes).filter((node) => {
      const removedAt = this.#removedAtLastSeen.get(node.id);
      if (removedAt === undefined) return true;
      if (node.lastSeenAt <= removedAt) return false;
      this.#removedAtLastSeen.delete(node.id);
      return true;
    });
    this.emit();
  }

  reset(): void {
    if (this.#nodes.length === 0 && this.#removedAtLastSeen.size === 0) return;
    this.#nodes = [];
    this.#removedAtLastSeen.clear();
    this.emit();
  }

  remove(nodeId: string): void {
    const removed = this.#nodes.find(({ id }) => id === nodeId);
    this.#removedAtLastSeen.set(nodeId, removed?.lastSeenAt ?? Number.MAX_SAFE_INTEGER);
    const nodes = this.#nodes.filter(({ id }) => id !== nodeId);
    if (nodes.length === this.#nodes.length) return;
    this.#nodes = nodes;
    this.emit();
  }

  update(nodeId: string, update: (node: NodoNode) => NodoNode): void {
    const index = this.#nodes.findIndex(({ id }) => id === nodeId);
    if (index < 0) return;
    const current = this.#nodes[index]!;
    const next = update(current);
    if (Object.is(current, next)) return;
    this.#nodes = [...this.#nodes];
    this.#nodes[index] = next;
    this.emit();
  }

  subscribe(subscriber: NodoRegistrySubscriber): () => void {
    this.#subscribers.add(subscriber);
    subscriber(this.#nodes);
    return () => this.#subscribers.delete(subscriber);
  }

  private emit(): void {
    for (const subscriber of [...this.#subscribers]) subscriber(this.#nodes);
  }
}

function deduplicate(nodes: readonly NodoNode[]): NodoNode[] {
  const unique = new Map<string, NodoNode>();
  for (const node of nodes) {
    const current = unique.get(node.id);
    if (!current || node.lastSeenAt > current.lastSeenAt) unique.set(node.id, node);
  }
  return [...unique.values()];
}
