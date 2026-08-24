import type { IloCardInput, IloErrorEntry, IloSnapshot } from '../domain/ilo';
import { EMPTY_ILO_PROGRESS } from '../domain/ilo';
import type { IloGateway } from '../gateways/IloGateway';
import { GState } from '../state/GState';

const EMPTY_SNAPSHOT: IloSnapshot = {
  busy: null,
  cards: [],
  cardsHasMore: false,
  cardsLoaded: false,
  cardsLoading: false,
  error: null,
  logs: [],
  phase: 'idle',
  refreshing: false,
  progress: EMPTY_ILO_PROGRESS,
  settings: { nativeLabel: 'russian', onboarded: false },
  themes: [],
  train: { active: 0, card: null, due: 0 },
};

// Switching between application sections should reuse a recent bootstrap.
// An explicit refresh still bypasses this window, while a stale section entry
// avoids an unnecessary Worker/D1 round-trip.
const BOOTSTRAP_STALE_AFTER_MS = 30_000;
const CARDS_PAGE_SIZE = 50;

export class IloGState extends GState<IloSnapshot> {
  #ownerId: string | null = null;
  #entered = false;
  #requestId = 0;
  #cardsRequestId = 0;
  #refreshInFlight: Promise<void> | null = null;
  #cardsInFlight: { key: string; promise: Promise<void> } | null = null;
  #lastRefreshAt = 0;
  #cardsOffset = 0;
  #cardsQuery = { q: '', theme: '' };

  constructor(private readonly gateway: IloGateway) {
    super({ ...EMPTY_SNAPSHOT, progress: { ...EMPTY_ILO_PROGRESS } });
  }

  configure(ownerId: string | null): void {
    if (ownerId === this.#ownerId) return;
    this.#ownerId = ownerId;
    this.reset();
    if (ownerId) this.update((snapshot) => ({ ...snapshot, logs: readLogs(ownerId) }));
    if (this.#entered && ownerId) void this.refresh(false);
  }

  override enter(): void {
    this.#entered = true;
    if (this.#ownerId) void this.refresh(false);
  }

  override exit(): void {
    this.#entered = false;
    this.#requestId += 1;
    this.#cardsRequestId += 1;
    this.#refreshInFlight = null;
    this.#cardsInFlight = null;
    this.update((snapshot) => ({ ...snapshot, cardsLoading: false, busy: null, refreshing: false }));
  }

  reset(): void {
    this.#requestId += 1;
    this.#cardsRequestId += 1;
    this.#refreshInFlight = null;
    this.#cardsInFlight = null;
    this.#lastRefreshAt = 0;
    this.#cardsOffset = 0;
    this.#cardsQuery = { q: '', theme: '' };
    this.publish({ ...EMPTY_SNAPSHOT, progress: { ...EMPTY_ILO_PROGRESS } });
  }

  refresh(force = true): Promise<void> {
    if (this.snapshot.busy) return Promise.resolve();
    if (this.#refreshInFlight) return this.#refreshInFlight;
    const ownerId = this.#ownerId;
    if (!ownerId) return Promise.resolve();
    if (
      !force &&
      this.snapshot.phase === 'ready' &&
      Date.now() - this.#lastRefreshAt < BOOTSTRAP_STALE_AFTER_MS
    ) {
      return Promise.resolve();
    }
    const requestId = ++this.#requestId;
    this.update((snapshot) => ({
      ...snapshot,
      error: null,
      phase: snapshot.phase === 'ready' ? 'ready' : 'loading',
      refreshing: true,
    }));
    let request: Promise<void>;
    request = (async () => {
      try {
        const bootstrap = await this.gateway.bootstrap();
        if (requestId !== this.#requestId || ownerId !== this.#ownerId) return;
        this.#lastRefreshAt = Date.now();
        this.publish({
          ...this.snapshot,
          error: null,
          phase: 'ready',
          refreshing: false,
          progress: bootstrap.progress,
          settings: bootstrap.settings,
          themes: bootstrap.themes,
          train: bootstrap.train,
        });
      } catch (error) {
        if (requestId !== this.#requestId || ownerId !== this.#ownerId) return;
        this.fail('bootstrap', error);
        this.update((snapshot) => ({ ...snapshot, phase: 'ready', refreshing: false }));
      }
    })().finally(() => {
      if (this.#refreshInFlight === request) this.#refreshInFlight = null;
    });
    this.#refreshInFlight = request;
    return request;
  }

  searchCards(q: string, theme: string, force = false): Promise<void> {
    const nextQuery = { q: q.trim(), theme: theme.trim() };
    if (
      !force &&
      this.snapshot.cardsLoaded &&
      !this.snapshot.cardsLoading &&
      this.#cardsQuery.q === nextQuery.q &&
      this.#cardsQuery.theme === nextQuery.theme
    ) {
      return Promise.resolve();
    }
    this.#cardsQuery = nextQuery;
    this.#cardsOffset = 0;
    return this.loadCards(false);
  }

  loadMoreCards(): Promise<void> {
    if (!this.snapshot.cardsHasMore || this.snapshot.cardsLoading) return Promise.resolve();
    return this.loadCards(true);
  }

  async createCard(input: IloCardInput): Promise<boolean> {
    return this.mutate('create card', () => this.gateway.createCard(input));
  }

  async updateCard(cardId: string, input: IloCardInput): Promise<boolean> {
    return this.mutate('update card', () => this.gateway.updateCard(cardId, input));
  }

  async deleteCard(cardId: string): Promise<boolean> {
    const ok = await this.mutate('delete card', () => this.gateway.deleteCard(cardId));
    if (ok) this.update((snapshot) => ({ ...snapshot, cards: snapshot.cards.filter((card) => card.id !== cardId) }));
    return ok;
  }

  async deleteCards(cardIds: string[]): Promise<boolean> {
    const uniqueIds = [...new Set(cardIds)];
    if (uniqueIds.length === 0) return false;
    const ok = await this.mutate('delete cards', () => this.gateway.deleteCards(uniqueIds));
    if (ok) {
      const removed = new Set(uniqueIds);
      this.update((snapshot) => ({ ...snapshot, cards: snapshot.cards.filter((card) => !removed.has(card.id)) }));
    }
    return ok;
  }

  async grade(cardId: string, action: 'forgot' | 'remember'): Promise<boolean> {
    return this.mutate(action === 'remember' ? 'remember card' : 'forgot card', () => this.gateway.grade(cardId, action));
  }

  clearError(): void { this.update((snapshot) => ({ ...snapshot, error: null })); }
  clearLogs(): void {
    if (this.#ownerId) writeLogs(this.#ownerId, []);
    this.update((snapshot) => ({ ...snapshot, logs: [] }));
  }

  private async loadCards(append: boolean): Promise<void> {
    const ownerId = this.#ownerId;
    if (!ownerId) return;
    const offset = append ? this.#cardsOffset : 0;
    const key = `${this.#cardsQuery.q}\u0000${this.#cardsQuery.theme}\u0000${offset}`;
    if (this.#cardsInFlight?.key === key) return this.#cardsInFlight.promise;
    const requestId = ++this.#cardsRequestId;
    this.update((snapshot) => ({ ...snapshot, cardsLoading: true, error: null }));
    const promise = (async () => {
      try {
        const page = await this.gateway.listCards({ ...this.#cardsQuery, limit: CARDS_PAGE_SIZE, offset });
        if (requestId !== this.#cardsRequestId || ownerId !== this.#ownerId) return;
        this.#cardsOffset = page.nextOffset ?? offset + page.cards.length;
        this.update((snapshot) => ({
          ...snapshot,
          cards: append ? [...snapshot.cards, ...page.cards] : page.cards,
          cardsHasMore: page.nextOffset !== null,
          cardsLoaded: true,
          cardsLoading: false,
        }));
      } catch (error) {
        if (requestId !== this.#cardsRequestId || ownerId !== this.#ownerId) return;
        this.fail('load cards', error);
        this.update((snapshot) => ({ ...snapshot, cardsLoading: false }));
      }
    })();
    this.#cardsInFlight = { key, promise };
    try {
      await promise;
    } finally {
      if (this.#cardsInFlight?.promise === promise) this.#cardsInFlight = null;
    }
  }

  private async mutate(operation: string, request: () => ReturnType<IloGateway['createCard']>): Promise<boolean> {
    if (this.snapshot.busy || this.snapshot.refreshing) return false;
    const ownerId = this.#ownerId;
    if (!ownerId) return false;
    const requestId = ++this.#requestId;
    this.#cardsRequestId += 1;
    this.update((snapshot) => ({ ...snapshot, busy: operation, cardsLoading: false, error: null }));
    try {
      const result = await request();
      if (requestId !== this.#requestId || ownerId !== this.#ownerId) return false;
      // Mutation responses include the current training/progress snapshot, so
      // a section switch immediately after saving does not need another
      // bootstrap request.
      this.#lastRefreshAt = Date.now();
      this.update((snapshot) => ({
        ...snapshot,
        busy: null,
        cards: result.card ? replaceCard(snapshot.cards, result.card) : snapshot.cards,
        error: null,
        progress: result.progress,
        train: result.train,
      }));
      return true;
    } catch (error) {
      if (requestId !== this.#requestId || ownerId !== this.#ownerId) return false;
      this.fail(operation, error);
      this.update((snapshot) => ({ ...snapshot, busy: null }));
      return false;
    }
  }

  private fail(operation: string, error: unknown): void {
    const message = readableError(error);
    const entry: IloErrorEntry = { at: Date.now(), message, operation };
    const logs = [entry, ...this.snapshot.logs].slice(0, 20);
    if (this.#ownerId) writeLogs(this.#ownerId, logs);
    this.update((snapshot) => ({
      ...snapshot,
      error: message,
      logs,
    }));
  }
}

function replaceCard(cards: IloSnapshot['cards'], next: NonNullable<Awaited<ReturnType<IloGateway['createCard']>>['card']>): IloSnapshot['cards'] {
  if (!next) return cards;
  const index = cards.findIndex((card) => card.id === next.id);
  if (index < 0) return [next, ...cards];
  return cards.map((card, cardIndex) => cardIndex === index ? next : card);
}

function readableError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Lingvolernado is unavailable.';
}

function logKey(ownerId: string): string {
  return `kaordo.ilo.errors.v1.${ownerId}`;
}

function readLogs(ownerId: string): IloErrorEntry[] {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(logKey(ownerId)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is IloErrorEntry => (
      typeof entry === 'object' && entry !== null
      && typeof (entry as IloErrorEntry).at === 'number'
      && typeof (entry as IloErrorEntry).message === 'string'
      && typeof (entry as IloErrorEntry).operation === 'string'
    )).slice(0, 20);
  } catch {
    return [];
  }
}

function writeLogs(ownerId: string, logs: IloErrorEntry[]): void {
  try {
    if (logs.length === 0) globalThis.localStorage?.removeItem(logKey(ownerId));
    else globalThis.localStorage?.setItem(logKey(ownerId), JSON.stringify(logs));
  } catch {
    // Diagnostics must never break learning when local storage is unavailable.
  }
}
