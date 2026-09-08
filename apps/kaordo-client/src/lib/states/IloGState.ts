import type {
  IloCardInput, IloCardPage, IloErrorEntry, IloSnapshot, TaglibroDay, TaglibroEventInput, TaglibroPlan,
} from '../domain/ilo';
import { EMPTY_ILO_PROGRESS, EMPTY_TAGLIBRO_SNAPSHOT } from '../domain/ilo';
import {
  DESEGN_FOCUSES,
  EMPTY_DESEGN_LERNADO,
  type DesegnDrawing,
  type DesegnDrawingPatch,
  type DesegnPetPalette,
  type DesegnPetProfile,
  type DesegnReviewOutcome,
} from '../domain/desegnLernado';
import {
  EMPTY_LINGVOLERNANDO_GAME,
  type LingvolernandoGameSnapshot,
  type LingvolernandoPetPalette,
  type LingvolernandoRewardOutcome,
} from '../domain/lingvolernando';
import type { IloGateway } from '../gateways/IloGateway';
import {
  createDesegnLernadoStore,
  type DesegnLernadoStore,
  type DesegnMediaVariant,
} from '../services/DesegnLernadoStore';
import { isDesegnImageFile, prepareDesegnDrawing } from '../services/desegnLernadoMedia';
import {
  desegnStats,
  reviewedDrawing,
  unlockedDesegnArtifacts,
} from '../services/desegnLernadoProgress';
import {
  completeLingvolernandoJourneyRecall,
  equipLingvolernandoArtifact,
  evolveLingvolernandoArtifact,
  metricsFromProgress,
  readLingvolernandoGame,
  recordLingvolernandoTrainingAnswer,
  renameLingvolernandoPet,
  setLingvolernandoBiome,
  setLingvolernandoPetPalette,
  syncLingvolernandoCardCount,
  toggleLingvolernandoPetArtifact,
  writeLingvolernandoGame,
} from '../services/lingvolernandoGame';
import { GState } from '../state/GState';

const EMPTY_SNAPSHOT: IloSnapshot = {
  busy: null,
  cards: [],
  cardsHasMore: false,
  cardsLoaded: false,
  cardsLoading: false,
  desegnLernado: structuredClone(EMPTY_DESEGN_LERNADO),
  error: null,
  lingvolernando: structuredClone(EMPTY_LINGVOLERNANDO_GAME),
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
const DESEGN_ORIGINAL_URL_LIMIT = 2;
const DESEGN_THUMBNAIL_URL_LIMIT = 160;
const CARD_PAGE_CACHE_LIMIT = 8;
const CARD_PAGE_CACHE_TTL_MS = 60_000;
const TAGLIBRO_DAY_CACHE_LIMIT = 62;

type DesegnMediaUrlEntry = {
  lastUsedAt: number;
  refs: number;
  url: string;
};

type CachedCardPage = {
  cachedAt: number;
  page: IloCardPage;
};

function freshSnapshot(): IloSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    desegnLernado: structuredClone(EMPTY_DESEGN_LERNADO),
    lingvolernando: structuredClone(EMPTY_LINGVOLERNANDO_GAME),
    progress: { ...EMPTY_ILO_PROGRESS },
    taglibro: { ...EMPTY_TAGLIBRO_SNAPSHOT },
  };
}

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
  #cardsCache = new Map<string, CachedCardPage>();
  #taglibroBootstrapRequestId = 0;
  #taglibroDayRequestId = 0;
  #taglibroEventsRequestId = 0;
  #taglibroMutationRequestId = 0;
  #taglibroInFlight: Promise<void> | null = null;
  #taglibroDayInFlight = new Map<string, Promise<void>>();
  #taglibroEventsInFlight = new Map<boolean, Promise<void>>();
  #taglibroDays = new Map<string, TaglibroDay>();
  #desegnLoadRequestId = 0;
  #desegnLoadInFlight: Promise<void> | null = null;
  #desegnMediaUrls = new Map<string, DesegnMediaUrlEntry>();
  #desegnMediaLoads = new Map<string, Promise<string | null>>();
  #desegnMediaWaiters = new Map<string, number>();

  constructor(
    private readonly gateway: IloGateway,
    private readonly desegnStore: DesegnLernadoStore = createDesegnLernadoStore(),
  ) {
    super(freshSnapshot());
  }

  configure(ownerId: string | null): void {
    if (ownerId === this.#ownerId) return;
    this.#ownerId = ownerId;
    this.reset();
    if (ownerId) {
      this.update((snapshot) => ({
        ...snapshot,
        lingvolernando: readLingvolernandoGame(ownerId),
        logs: readLogs(ownerId),
      }));
    }
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
    this.invalidateDesegnRequests();
    this.#refreshInFlight = null;
    this.#cardsInFlight = null;
    this.update((snapshot) => ({
      ...snapshot,
      cardsLoading: false,
      busy: null,
      refreshing: false,
      desegnLernado: { ...snapshot.desegnLernado, busy: null },
      taglibro: { ...snapshot.taglibro, busy: null, refreshing: false },
    }));
  }

  reset(): void {
    this.#requestId += 1;
    this.#cardsRequestId += 1;
    this.invalidateTaglibroRequests();
    this.invalidateDesegnRequests();
    this.#refreshInFlight = null;
    this.#cardsInFlight = null;
    this.#lastRefreshAt = 0;
    this.#cardsOffset = 0;
    this.#cardsQuery = { q: '', theme: '' };
    this.#cardsCache.clear();
    this.#taglibroDays.clear();
    this.publish(freshSnapshot());
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

  private invalidateDesegnRequests(): void {
    this.#desegnLoadRequestId += 1;
    this.#desegnLoadInFlight = null;
    this.#desegnMediaLoads.clear();
    this.#desegnMediaWaiters.clear();
    for (const entry of this.#desegnMediaUrls.values()) URL.revokeObjectURL(entry.url);
    this.#desegnMediaUrls.clear();
  }

  loadDesegnLernado(force = false): Promise<void> {
    if (this.#desegnLoadInFlight) return this.#desegnLoadInFlight;
    const ownerId = this.#ownerId;
    if (!ownerId) return Promise.resolve();
    if (!force && this.snapshot.desegnLernado.phase === 'ready') return Promise.resolve();
    const requestId = ++this.#desegnLoadRequestId;
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: {
        ...snapshot.desegnLernado,
        error: null,
        phase: snapshot.desegnLernado.phase === 'ready' ? 'ready' : 'loading',
      },
    }));
    let request: Promise<void>;
    request = (async () => {
      try {
        const archive = await this.desegnStore.load(ownerId);
        if (requestId !== this.#desegnLoadRequestId || ownerId !== this.#ownerId) return;
        this.update((snapshot) => ({
          ...snapshot,
          desegnLernado: {
            ...snapshot.desegnLernado,
            drawings: archive.drawings,
            error: null,
            pet: archive.pet,
            phase: 'ready',
          },
        }));
      } catch (error) {
        if (requestId !== this.#desegnLoadRequestId || ownerId !== this.#ownerId) return;
        this.desegnFail(error);
        this.update((snapshot) => ({
          ...snapshot,
          desegnLernado: { ...snapshot.desegnLernado, phase: 'ready' },
        }));
      }
    })().finally(() => {
      if (this.#desegnLoadInFlight === request) this.#desegnLoadInFlight = null;
    });
    this.#desegnLoadInFlight = request;
    return request;
  }

  async addDesegnDrawings(files: readonly File[]): Promise<{
    added: number;
    errors: string[];
    unlockedArtifactIds: string[];
  }> {
    const ownerId = this.#ownerId;
    const images = files.filter(isDesegnImageFile);
    if (!ownerId || images.length === 0 || this.snapshot.desegnLernado.busy) {
      return { added: 0, errors: [], unlockedArtifactIds: [] };
    }

    const before = new Set(unlockedDesegnArtifacts(desegnStats(this.snapshot.desegnLernado.drawings)).map((item) => item.id));
    const added: DesegnDrawing[] = [];
    const errors: string[] = [];
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: { ...snapshot.desegnLernado, busy: 'Preparing drawings', error: null },
    }));
    for (const [index, file] of images.entries()) {
      if (ownerId !== this.#ownerId) break;
      this.update((snapshot) => ({
        ...snapshot,
        desegnLernado: { ...snapshot.desegnLernado, busy: `Preparing ${index + 1} of ${images.length}` },
      }));
      try {
        const prepared = await prepareDesegnDrawing(file, Date.now() + index);
        await this.desegnStore.saveDrawing(ownerId, prepared.drawing, prepared.original, prepared.thumbnail);
        added.push(prepared.drawing);
      } catch (error) {
        errors.push(readableDesegnError(error));
      }
    }
    if (ownerId !== this.#ownerId) return { added: 0, errors, unlockedArtifactIds: [] };
    const drawings = [...added, ...this.snapshot.desegnLernado.drawings]
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
    const after = unlockedDesegnArtifacts(desegnStats(drawings));
    const unlockedArtifactIds = after.filter((item) => !before.has(item.id)).map((item) => item.id);
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: {
        ...snapshot.desegnLernado,
        busy: null,
        drawings,
        error: errors.length > 0 ? errors.join(' ') : null,
        phase: 'ready',
      },
    }));
    return { added: added.length, errors, unlockedArtifactIds };
  }

  async updateDesegnDrawing(drawingId: string, patch: DesegnDrawingPatch): Promise<boolean> {
    const current = this.snapshot.desegnLernado.drawings.find((drawing) => drawing.id === drawingId);
    if (!current) return false;
    const updatedAt = Date.now();
    const description = typeof patch.description === 'string' ? patch.description : '';
    const shortcomings = Array.isArray(patch.shortcomings) ? patch.shortcomings : [];
    const title = typeof patch.title === 'string' ? patch.title : '';
    const rating = typeof patch.rating === 'number' && Number.isFinite(patch.rating)
      ? Math.min(5, Math.max(1, Math.round(patch.rating)))
      : null;
    const next: DesegnDrawing = {
      ...current,
      description: description.trim().slice(0, 2_000),
      focus: DESEGN_FOCUSES.includes(patch.focus) ? patch.focus : 'other',
      rating,
      shortcomings: [...new Set(shortcomings
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean))]
        .slice(0, 20)
        .map((item) => item.slice(0, 300)),
      title: title.trim().slice(0, 100) || 'Untitled drawing',
      updatedAt,
    };
    return this.persistDesegnDrawing(next, 'Saving notes');
  }

  async reviewDesegnDrawing(drawingId: string, outcome: DesegnReviewOutcome): Promise<boolean> {
    const current = this.snapshot.desegnLernado.drawings.find((drawing) => drawing.id === drawingId);
    return current ? this.persistDesegnDrawing(reviewedDrawing(current, outcome), 'Saving review') : false;
  }

  async deleteDesegnDrawing(drawingId: string): Promise<boolean> {
    const ownerId = this.#ownerId;
    if (!ownerId || this.snapshot.desegnLernado.busy) return false;
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: { ...snapshot.desegnLernado, busy: 'Removing drawing', error: null },
    }));
    try {
      await this.desegnStore.deleteDrawing(ownerId, drawingId);
      if (ownerId !== this.#ownerId) return false;
      this.revokeDesegnDrawingUrls(ownerId, drawingId);
      this.update((snapshot) => ({
        ...snapshot,
        desegnLernado: {
          ...snapshot.desegnLernado,
          busy: null,
          drawings: snapshot.desegnLernado.drawings.filter((drawing) => drawing.id !== drawingId),
        },
      }));
      return true;
    } catch (error) {
      if (ownerId !== this.#ownerId) return false;
      this.desegnFail(error);
      this.update((snapshot) => ({
        ...snapshot,
        desegnLernado: { ...snapshot.desegnLernado, busy: null },
      }));
      return false;
    }
  }

  desegnLernadoMediaUrl(drawingId: string, variant: DesegnMediaVariant): Promise<string | null> {
    const ownerId = this.#ownerId;
    if (!ownerId) return Promise.resolve(null);
    const key = `${ownerId}:${drawingId}:${variant}`;
    const cached = this.#desegnMediaUrls.get(key);
    if (cached) {
      cached.refs += 1;
      cached.lastUsedAt = Date.now();
      return Promise.resolve(cached.url);
    }
    this.#desegnMediaWaiters.set(key, (this.#desegnMediaWaiters.get(key) ?? 0) + 1);
    const active = this.#desegnMediaLoads.get(key);
    if (active) return active;
    const requestId = this.#desegnLoadRequestId;
    const request = this.desegnStore.loadMedia(ownerId, drawingId, variant)
      .then((blob) => {
        const refs = this.#desegnMediaWaiters.get(key) ?? 0;
        this.#desegnMediaWaiters.delete(key);
        // Deleting a drawing removes its in-flight entry. Treat a response
        // from that orphaned request as stale so it cannot resurrect a blob
        // URL for media that no longer exists.
        if (!blob || ownerId !== this.#ownerId || requestId !== this.#desegnLoadRequestId || this.#desegnMediaLoads.get(key) !== request) return null;
        const url = URL.createObjectURL(blob);
        this.#desegnMediaUrls.set(key, { lastUsedAt: Date.now(), refs, url });
        this.trimDesegnMediaUrls(variant, variant === 'original' ? DESEGN_ORIGINAL_URL_LIMIT : DESEGN_THUMBNAIL_URL_LIMIT);
        return url;
      })
      .catch((error) => {
        this.#desegnMediaWaiters.delete(key);
        if (ownerId === this.#ownerId && requestId === this.#desegnLoadRequestId) this.desegnFail(error);
        return null;
      })
      .finally(() => {
        if (this.#desegnMediaLoads.get(key) === request) this.#desegnMediaLoads.delete(key);
      });
    this.#desegnMediaLoads.set(key, request);
    return request;
  }

  /** Release one media URL lease acquired by desegnLernadoMediaUrl. */
  releaseDesegnLernadoMediaUrl(drawingId: string, variant: DesegnMediaVariant): void {
    const ownerId = this.#ownerId;
    if (!ownerId) return;
    const key = `${ownerId}:${drawingId}:${variant}`;
    const cached = this.#desegnMediaUrls.get(key);
    if (cached) {
      cached.refs = Math.max(0, cached.refs - 1);
      cached.lastUsedAt = Date.now();
      this.trimDesegnMediaUrls(variant, variant === 'original' ? DESEGN_ORIGINAL_URL_LIMIT : DESEGN_THUMBNAIL_URL_LIMIT);
      return;
    }
    const waiting = this.#desegnMediaWaiters.get(key);
    if (waiting) this.#desegnMediaWaiters.set(key, waiting - 1);
  }

  async renameDesegnPet(name: string): Promise<boolean> {
    const nextName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
    return this.persistDesegnPet({ ...this.snapshot.desegnLernado.pet, name: nextName || 'Moki' });
  }

  async setDesegnPetPalette(palette: DesegnPetPalette): Promise<boolean> {
    if (palette !== 'ink' && palette !== 'mint' && palette !== 'sunset' && palette !== 'night') return false;
    return this.persistDesegnPet({ ...this.snapshot.desegnLernado.pet, palette });
  }

  async equipDesegnArtifact(artifactId: string | null, slot: number): Promise<boolean> {
    if (slot < 0 || slot > 2) return false;
    if (artifactId) {
      const unlocked = new Set(unlockedDesegnArtifacts(desegnStats(this.snapshot.desegnLernado.drawings)).map((item) => item.id));
      if (!unlocked.has(artifactId)) return false;
    }
    const equippedArtifactIds = [...this.snapshot.desegnLernado.pet.equippedArtifactIds].slice(0, 3);
    while (equippedArtifactIds.length < 3) equippedArtifactIds.push(null);
    if (artifactId) {
      for (let index = 0; index < equippedArtifactIds.length; index += 1) {
        if (equippedArtifactIds[index] === artifactId) equippedArtifactIds[index] = null;
      }
    }
    equippedArtifactIds[slot] = artifactId;
    return this.persistDesegnPet({ ...this.snapshot.desegnLernado.pet, equippedArtifactIds });
  }

  clearDesegnError(): void {
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: { ...snapshot.desegnLernado, error: null },
    }));
  }

  refreshTaglibro(force = true): Promise<void> {
    if (this.#taglibroInFlight) return this.#taglibroInFlight;
    const ownerId = this.#ownerId;
    if (!ownerId) return Promise.resolve();
    const current = this.snapshot.taglibro;
    if (current.busy) return Promise.resolve();
    if (!force && current.phase === 'ready') return Promise.resolve();
    // Bootstrap contains both today's day and the event list. Supersede
    // narrower reads started before it so an older response cannot overwrite
    // the freshly selected day or event snapshot when it resolves later.
    this.#taglibroDayRequestId += 1;
    this.#taglibroDayInFlight.clear();
    this.#taglibroEventsRequestId += 1;
    this.#taglibroEventsInFlight.clear();
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
        this.cacheTaglibroDay(bootstrap.today);
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
        this.cacheTaglibroDay(day);
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
        const lingvolernando = syncLingvolernandoCardCount(this.snapshot.lingvolernando, bootstrap.progress.active);
        writeLingvolernandoGame(ownerId, lingvolernando);
        this.publish({
          ...this.snapshot,
          error: null,
          lingvolernando,
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
    if (force) this.#cardsCache.clear();
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

  async grade(cardId: string, action: 'forgot' | 'remember'): Promise<{
    changed: boolean;
    reward: LingvolernandoRewardOutcome | null;
  }> {
    const trainingCard = this.snapshot.train.card?.id === cardId ? this.snapshot.train.card : null;
    const changed = await this.mutate(action === 'remember' ? 'remember card' : 'forgot card', () => this.gateway.grade(cardId, action));
    if (!changed || !trainingCard) return { changed, reward: null };
    const ownerId = this.#ownerId;
    if (!ownerId) return { changed, reward: null };
    const german = trainingCard.answerLines.find((line) => line.startsWith('German: '))?.slice(8).trim() ?? trainingCard.promptText.trim();
    const translation = trainingCard.answerLines.find((line) => line.startsWith('Meaning: '))?.slice(9).trim()
      ?? trainingCard.answerLines[0]?.replace(/^[^:]+:\s*/, '').trim()
      ?? '';
    const result = recordLingvolernandoTrainingAnswer(
      this.snapshot.lingvolernando,
      metricsFromProgress(this.snapshot.progress),
      { german, id: cardId, stage: trainingCard.stage, translation },
      action,
    );
    this.persistLingvolernando(ownerId, result.game);
    return { changed: true, reward: result.outcome };
  }

  answerLingvolernandoJourney(remembered: boolean): LingvolernandoRewardOutcome | null {
    const ownerId = this.#ownerId;
    if (!ownerId) return null;
    const result = completeLingvolernandoJourneyRecall(
      this.snapshot.lingvolernando,
      metricsFromProgress(this.snapshot.progress),
      remembered,
    );
    this.persistLingvolernando(ownerId, result.game);
    return result.outcome;
  }

  equipLingvolernandoArtifact(artifactId: string, slot: number): void {
    this.updateLingvolernando((game) => equipLingvolernandoArtifact(game, artifactId, slot));
  }

  evolveLingvolernandoArtifact(artifactId: string): void {
    this.updateLingvolernando((game) => evolveLingvolernandoArtifact(game, artifactId));
  }

  selectLingvolernandoBiome(index: number): void {
    this.updateLingvolernando((game) => setLingvolernandoBiome(game, index));
  }

  renameLingvolernandoPet(name: string): void {
    this.updateLingvolernando((game) => renameLingvolernandoPet(game, name));
  }

  setLingvolernandoPetPalette(palette: LingvolernandoPetPalette): void {
    this.updateLingvolernando((game) => setLingvolernandoPetPalette(game, palette));
  }

  toggleLingvolernandoPetArtifact(artifactId: string): void {
    this.updateLingvolernando((game) => toggleLingvolernandoPetArtifact(game, artifactId));
  }

  clearError(): void { this.update((snapshot) => ({ ...snapshot, error: null })); }
  clearLogs(): void {
    if (this.#ownerId) writeLogs(this.#ownerId, []);
    this.update((snapshot) => ({ ...snapshot, logs: [] }));
  }

  private updateLingvolernando(
    reducer: (game: Readonly<LingvolernandoGameSnapshot>) => LingvolernandoGameSnapshot,
  ): void {
    const ownerId = this.#ownerId;
    if (!ownerId) return;
    this.persistLingvolernando(ownerId, reducer(this.snapshot.lingvolernando));
  }

  private persistLingvolernando(ownerId: string, game: LingvolernandoGameSnapshot): void {
    writeLingvolernandoGame(ownerId, game);
    this.update((snapshot) => ({ ...snapshot, lingvolernando: game }));
  }

  private async persistDesegnDrawing(drawing: DesegnDrawing, operation: string): Promise<boolean> {
    const ownerId = this.#ownerId;
    if (!ownerId || this.snapshot.desegnLernado.busy) return false;
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: { ...snapshot.desegnLernado, busy: operation, error: null },
    }));
    try {
      await this.desegnStore.updateDrawing(ownerId, drawing);
      if (ownerId !== this.#ownerId) return false;
      this.update((snapshot) => ({
        ...snapshot,
        desegnLernado: {
          ...snapshot.desegnLernado,
          busy: null,
          drawings: snapshot.desegnLernado.drawings.map((item) => item.id === drawing.id ? drawing : item),
        },
      }));
      return true;
    } catch (error) {
      if (ownerId !== this.#ownerId) return false;
      this.desegnFail(error);
      this.update((snapshot) => ({
        ...snapshot,
        desegnLernado: { ...snapshot.desegnLernado, busy: null },
      }));
      return false;
    }
  }

  private async persistDesegnPet(pet: DesegnPetProfile): Promise<boolean> {
    const ownerId = this.#ownerId;
    if (!ownerId || this.snapshot.desegnLernado.busy) return false;
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: { ...snapshot.desegnLernado, busy: 'Saving companion', error: null },
    }));
    try {
      await this.desegnStore.savePet(ownerId, pet);
      if (ownerId !== this.#ownerId) return false;
      this.update((snapshot) => ({
        ...snapshot,
        desegnLernado: { ...snapshot.desegnLernado, busy: null, pet },
      }));
      return true;
    } catch (error) {
      if (ownerId !== this.#ownerId) return false;
      this.desegnFail(error);
      this.update((snapshot) => ({
        ...snapshot,
        desegnLernado: { ...snapshot.desegnLernado, busy: null },
      }));
      return false;
    }
  }

  private revokeDesegnDrawingUrls(ownerId: string, drawingId: string): void {
    for (const variant of ['original', 'thumbnail'] as const) {
      const key = `${ownerId}:${drawingId}:${variant}`;
      const entry = this.#desegnMediaUrls.get(key);
      if (entry) URL.revokeObjectURL(entry.url);
      this.#desegnMediaUrls.delete(key);
      this.#desegnMediaWaiters.delete(key);
      this.#desegnMediaLoads.delete(key);
    }
  }

  private trimDesegnMediaUrls(variant: DesegnMediaVariant, limit: number): void {
    const suffix = `:${variant}`;
    const matching = [...this.#desegnMediaUrls.entries()]
      .filter(([key]) => key.endsWith(suffix))
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
    let remaining = Math.max(0, matching.length - limit);
    for (const [key, entry] of matching) {
      if (remaining <= 0) break;
      if (entry.refs > 0) continue;
      URL.revokeObjectURL(entry.url);
      this.#desegnMediaUrls.delete(key);
      remaining -= 1;
    }
  }

  private desegnFail(error: unknown): void {
    this.update((snapshot) => ({
      ...snapshot,
      desegnLernado: { ...snapshot.desegnLernado, error: readableDesegnError(error) },
    }));
  }

  private async loadCards(append: boolean): Promise<void> {
    const ownerId = this.#ownerId;
    if (!ownerId) return;
    const offset = append ? this.#cardsOffset : 0;
    const key = `${this.#cardsQuery.q}\u0000${this.#cardsQuery.theme}\u0000${offset}`;
    if (this.#cardsInFlight?.key === key) return this.#cardsInFlight.promise;
    const requestId = ++this.#cardsRequestId;
    const cached = this.#cardsCache.get(key);
    if (cached && Date.now() - cached.cachedAt < CARD_PAGE_CACHE_TTL_MS) {
      this.#cardsCache.delete(key);
      this.#cardsCache.set(key, cached);
      if (requestId === this.#cardsRequestId && ownerId === this.#ownerId) this.applyCardsPage(cached.page, append);
      return;
    }
    if (cached) this.#cardsCache.delete(key);
    this.update((snapshot) => ({ ...snapshot, cardsLoading: true, error: null }));
    const promise = (async () => {
      try {
        const page = await this.gateway.listCards({ ...this.#cardsQuery, limit: CARDS_PAGE_SIZE, offset });
        if (requestId !== this.#cardsRequestId || ownerId !== this.#ownerId) return;
        this.#cardsCache.set(key, { cachedAt: Date.now(), page });
        while (this.#cardsCache.size > CARD_PAGE_CACHE_LIMIT) this.#cardsCache.delete(this.#cardsCache.keys().next().value!);
        this.#cardsOffset = page.nextOffset ?? offset + page.cards.length;
        this.applyCardsPage(page, append);
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

  private applyCardsPage(page: IloCardPage, append: boolean): void {
    this.#cardsOffset = page.nextOffset ?? this.#cardsOffset;
    this.update((snapshot) => ({
      ...snapshot,
      cards: append ? [...snapshot.cards, ...page.cards] : page.cards,
      cardsHasMore: page.nextOffset !== null,
      cardsLoaded: true,
      cardsLoading: false,
    }));
  }

  private async mutate(operation: string, request: () => ReturnType<IloGateway['createCard']>): Promise<boolean> {
    if (this.snapshot.busy || this.snapshot.refreshing) return false;
    const ownerId = this.#ownerId;
    if (!ownerId) return false;
    const requestId = ++this.#requestId;
    this.#cardsRequestId += 1;
    this.#cardsCache.clear();
    this.update((snapshot) => ({ ...snapshot, busy: operation, cardsLoading: false, error: null }));
    try {
      const result = await request();
      if (requestId !== this.#requestId || ownerId !== this.#ownerId) return false;
      // Mutation responses include the current training/progress snapshot, so
      // a section switch immediately after saving does not need another
      // bootstrap request.
      this.#lastRefreshAt = Date.now();
      const lingvolernando = syncLingvolernandoCardCount(this.snapshot.lingvolernando, result.progress.active);
      writeLingvolernandoGame(ownerId, lingvolernando);
      this.update((snapshot) => ({
        ...snapshot,
        busy: null,
        cards: result.card ? replaceCard(snapshot.cards, result.card) : snapshot.cards,
        error: null,
        lingvolernando,
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
    if (!ownerId || this.snapshot.taglibro.busy || this.snapshot.taglibro.refreshing) return false;
    const requestId = ++this.#taglibroMutationRequestId;
    // A day write must win over a bootstrap that was already in flight. The
    // stale bootstrap is left to settle naturally, but its result is ignored.
    this.#taglibroBootstrapRequestId += 1;
    this.#taglibroInFlight = null;
    // A write supersedes a day read that started before it. Event loading is
    // independent and is deliberately allowed to continue.
    this.#taglibroDayRequestId += 1;
    this.#taglibroDayInFlight.clear();
    this.update((snapshot) => ({ ...snapshot, taglibro: { ...snapshot.taglibro, busy: operation, error: null } }));
    try {
      const day = await request();
      if (requestId !== this.#taglibroMutationRequestId || ownerId !== this.#ownerId) return false;
      this.cacheTaglibroDay(day);
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
    if (!ownerId || this.snapshot.taglibro.busy || this.snapshot.taglibro.refreshing) return undefined;
    const requestId = ++this.#taglibroEventsRequestId;
    // Event mutations also invalidate a bootstrap response that may contain
    // an older event list. The in-flight promise is not cancelled; its token
    // check prevents it from publishing stale data.
    this.#taglibroBootstrapRequestId += 1;
    this.#taglibroInFlight = null;
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

  private cacheTaglibroDay(day: TaglibroDay): void {
    this.#taglibroDays.delete(day.date);
    this.#taglibroDays.set(day.date, day);
    while (this.#taglibroDays.size > TAGLIBRO_DAY_CACHE_LIMIT) {
      this.#taglibroDays.delete(this.#taglibroDays.keys().next().value!);
    }
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
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 2_000);
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 2_000);
  return 'Lingvolernado is unavailable.';
}

function readableTaglibroError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 2_000);
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 2_000);
  return 'Taglibroplanilo is unavailable.';
}

function readableDesegnError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 2_000);
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 2_000);
  return 'DesegnLernado could not access its local gallery.';
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
    return value.flatMap((entry): IloErrorEntry[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const candidate = entry as Partial<IloErrorEntry>;
      if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)
        || typeof candidate.message !== 'string' || typeof candidate.operation !== 'string') return [];
      return [{
        at: candidate.at,
        message: candidate.message.trim().slice(0, 2_000),
        operation: candidate.operation.trim().slice(0, 120),
      }];
    }).slice(0, 20);
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
