import type {
  IloCardInput, IloErrorEntry, IloSnapshot, TaglibroDay, TaglibroEventInput, TaglibroPlan,
} from '../domain/ilo';
import { EMPTY_ILO_PROGRESS, EMPTY_TAGLIBRO_SNAPSHOT } from '../domain/ilo';
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
  taglibro: { ...EMPTY_TAGLIBRO_SNAPSHOT },
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
  #taglibroBootstrapRequestId = 0;
  #taglibroDayRequestId = 0;
  #taglibroEventsRequestId = 0;
  #taglibroMutationRequestId = 0;
  #taglibroInFlight: Promise<void> | null = null;
  #taglibroDayInFlight = new Map<string, Promise<void>>();
  #taglibroEventsInFlight = new Map<boolean, Promise<void>>();
  #taglibroDays = new Map<string, TaglibroDay>();

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
    this.invalidateTaglibroRequests();
    this.#refreshInFlight = null;
    this.#cardsInFlight = null;
    this.update((snapshot) => ({
      ...snapshot,
      cardsLoading: false,
      busy: null,
      refreshing: false,
      taglibro: { ...snapshot.taglibro, busy: null, refreshing: false },
    }));
  }

  reset(): void {
    this.#requestId += 1;
    this.#cardsRequestId += 1;
    this.invalidateTaglibroRequests();
    this.#refreshInFlight = null;
    this.#cardsInFlight = null;
    this.#lastRefreshAt = 0;
    this.#cardsOffset = 0;
    this.#cardsQuery = { q: '', theme: '' };
    this.#taglibroDays.clear();
    this.publish({ ...EMPTY_SNAPSHOT, progress: { ...EMPTY_ILO_PROGRESS } });
  }

  private invalidateTaglibroRequests(): void {
    this.#taglibroBootstrapRequestId += 1;
    this.#taglibroDayRequestId += 1;
    this.#taglibroEventsRequestId += 1;
    this.#taglibroMutationRequestId += 1;
    this.#taglibroInFlight = null;
    this.#taglibroDayInFlight.clear();
    this.#taglibroEventsInFlight.clear();
  }

  refreshTaglibro(force = true): Promise<void> {
    if (this.#taglibroInFlight) return this.#taglibroInFlight;
    const ownerId = this.#ownerId;
    if (!ownerId) return Promise.resolve();
    const current = this.snapshot.taglibro;
    if (!force && current.phase === 'ready') return Promise.resolve();
    const requestId = ++this.#taglibroBootstrapRequestId;
    this.update((snapshot) => ({
      ...snapshot,
      taglibro: { ...snapshot.taglibro, error: null, phase: current.phase === 'ready' ? 'ready' : 'loading', refreshing: true },
    }));
    let request: Promise<void>;
    request = (async () => {
      try {
        const bootstrap = await this.gateway.taglibroBootstrap();
        if (requestId !== this.#taglibroBootstrapRequestId || ownerId !== this.#ownerId) return;
        this.#taglibroDays.set(bootstrap.today.date, bootstrap.today);
        this.update((snapshot) => ({
          ...snapshot,
          taglibro: {
            ...snapshot.taglibro,
            bootstrap,
            error: null,
            events: bootstrap.events,
            eventsLoaded: true,
            eventsLoading: false,
            eventsIncludePast: false,
            phase: 'ready',
            refreshing: false,
            selectedDate: bootstrap.today.date,
          },
        }));
      } catch (error) {
        if (requestId !== this.#taglibroBootstrapRequestId || ownerId !== this.#ownerId) return;
        this.taglibroFail(error);
        this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, phase: 'ready', refreshing: false } }));
      }
    })().finally(() => {
      if (this.#taglibroInFlight === request) this.#taglibroInFlight = null;
    });
    this.#taglibroInFlight = request;
    return request;
  }

  loadTaglibroDay(date: string, force = false): Promise<void> {
    if (!date) return Promise.resolve();
    const cached = this.#taglibroDays.get(date);
    if (!force && cached) {
      this.setTaglibroDay(cached);
      return Promise.resolve();
    }
    const existing = this.#taglibroDayInFlight.get(date);
    if (existing) return existing;
    const ownerId = this.#ownerId;
    if (!ownerId) return Promise.resolve();
    const requestId = ++this.#taglibroDayRequestId;
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, error: null, selectedDate: date } }));
    const request = (async () => {
      try {
        const day = await this.gateway.taglibroDay(date);
        if (requestId !== this.#taglibroDayRequestId || ownerId !== this.#ownerId) return;
        this.#taglibroDays.set(date, day);
        this.setTaglibroDay(day);
      } catch (error) {
        if (requestId !== this.#taglibroDayRequestId || ownerId !== this.#ownerId) return;
        this.taglibroFail(error);
      }
    })();
    this.#taglibroDayInFlight.set(date, request);
    return request.finally(() => {
      if (this.#taglibroDayInFlight.get(date) === request) this.#taglibroDayInFlight.delete(date);
    });
  }

  async saveTaglibroPlans(date: string, plans: TaglibroPlan[]): Promise<boolean> {
    return this.taglibroMutation('save plans', () => this.gateway.taglibroSavePlans(date, plans));
  }

  async saveTaglibroDiary(date: string, diary: TaglibroDay['diary']): Promise<boolean> {
    return this.taglibroMutation('save diary', () => this.gateway.taglibroSaveDiary(date, diary));
  }

  async saveTaglibroDay(date: string, day: Pick<TaglibroDay, 'plans' | 'diary'>): Promise<boolean> {
    return this.taglibroMutation('save day', () => this.gateway.taglibroSaveDay(date, day));
  }

  loadTaglibroEvents(includePast = false, force = false): Promise<void> {
    const current = this.snapshot.taglibro;
    if (current.busy) return Promise.resolve();
    if (!force && current.eventsLoaded && current.eventsIncludePast === includePast) return Promise.resolve();
    const existing = this.#taglibroEventsInFlight.get(includePast);
    if (existing) return existing;
    const ownerId = this.#ownerId;
    if (!ownerId) return Promise.resolve();
    const requestId = ++this.#taglibroEventsRequestId;
    this.update((snapshot) => ({
      ...snapshot,
      taglibro: { ...snapshot.taglibro, error: null, eventsLoading: true },
    }));
    const request = (async () => {
      try {
        const result = await this.gateway.taglibroListEvents(includePast);
        if (requestId !== this.#taglibroEventsRequestId || ownerId !== this.#ownerId) return;
        this.update((snapshot) => ({
          ...snapshot,
          taglibro: {
            ...snapshot.taglibro,
            events: result.events,
            eventsIncludePast: includePast,
            eventsLoaded: true,
            eventsLoading: false,
          },
        }));
      } catch (error) {
        if (requestId !== this.#taglibroEventsRequestId || ownerId !== this.#ownerId) return;
        this.taglibroFail(error);
        this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, eventsLoading: false } }));
      }
    })();
    this.#taglibroEventsInFlight.set(includePast, request);
    return request.finally(() => {
      if (this.#taglibroEventsInFlight.get(includePast) === request) this.#taglibroEventsInFlight.delete(includePast);
    });
  }

  async createTaglibroEvent(input: TaglibroEventInput): Promise<boolean> {
    const event = await this.taglibroEventMutation('create event', () => this.gateway.taglibroCreateEvent(input));
    if (!event) return false;
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, events: insertEvent(snapshot.taglibro.events, event), eventsLoaded: true, eventsLoading: false, error: null } }));
    return true;
  }

  async updateTaglibroEvent(eventId: string, input: TaglibroEventInput): Promise<boolean> {
    const event = await this.taglibroEventMutation('update event', () => this.gateway.taglibroUpdateEvent(eventId, input));
    if (!event) return false;
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, events: insertEvent(snapshot.taglibro.events.filter((item) => item.id !== eventId), event), eventsLoaded: true, eventsLoading: false, error: null } }));
    return true;
  }

  async deleteTaglibroEvent(eventId: string): Promise<boolean> {
    const deleted = await this.taglibroEventMutation('delete event', async () => {
      await this.gateway.taglibroDeleteEvent(eventId);
      return true;
    });
    if (!deleted) return false;
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, events: snapshot.taglibro.events.filter((item) => item.id !== eventId), eventsLoading: false, error: null } }));
    return true;
  }

  clearTaglibroError(): void {
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, error: null } }));
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

  private async taglibroMutation(operation: string, request: () => Promise<TaglibroDay>): Promise<boolean> {
    const ownerId = this.#ownerId;
    if (!ownerId || this.snapshot.taglibro.busy) return false;
    const requestId = ++this.#taglibroMutationRequestId;
    // A write supersedes a day read that started before it. Event loading is
    // independent and is deliberately allowed to continue.
    this.#taglibroDayRequestId += 1;
    this.#taglibroDayInFlight.clear();
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, busy: operation, error: null } }));
    try {
      const day = await request();
      if (requestId !== this.#taglibroMutationRequestId || ownerId !== this.#ownerId) return false;
      this.#taglibroDays.set(day.date, day);
      this.setTaglibroDay(day);
      this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, busy: null, error: null } }));
      return true;
    } catch (error) {
      if (requestId !== this.#taglibroMutationRequestId || ownerId !== this.#ownerId) return false;
      this.taglibroFail(error);
      this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, busy: null } }));
      return false;
    }
  }

  private async taglibroEventMutation<T>(operation: string, request: () => Promise<T>): Promise<T | undefined> {
    const ownerId = this.#ownerId;
    if (!ownerId || this.snapshot.taglibro.busy) return undefined;
    const requestId = ++this.#taglibroEventsRequestId;
    this.update((snapshot) => ({
      ...snapshot,
      taglibro: { ...snapshot.taglibro, busy: operation, error: null, eventsLoading: false },
    }));
    try {
      const result = await request();
      if (requestId !== this.#taglibroEventsRequestId || ownerId !== this.#ownerId) return undefined;
      this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, busy: null, error: null } }));
      return result;
    } catch (error) {
      if (requestId !== this.#taglibroEventsRequestId || ownerId !== this.#ownerId) return undefined;
      this.taglibroFail(error);
      this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, busy: null } }));
      return undefined;
    }
  }

  private setTaglibroDay(day: TaglibroDay): void {
    this.update((snapshot) => {
      const taglibro = { ...snapshot.taglibro, calendar: day, selectedDate: day.date };
      const bootstrap = taglibro.bootstrap?.today.date === day.date
        ? { ...taglibro.bootstrap, today: day }
        : taglibro.bootstrap;
      return { ...snapshot, taglibro: { ...taglibro, bootstrap } };
    });
  }

  private taglibroFail(error: unknown): void {
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, error: readableTaglibroError(error) } }));
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

function readableTaglibroError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Taglibroplanilo is unavailable.';
}

function insertEvent(events: IloSnapshot['taglibro']['events'], next: IloSnapshot['taglibro']['events'][number]) {
  return [...events, next].sort((left, right) => left.eventAt - right.eventAt || left.id.localeCompare(right.id));
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
