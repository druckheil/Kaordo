import { describe, expect, it, vi } from 'vitest';
import type { IloGateway } from '../gateways/IloGateway';
import { EMPTY_ILO_PROGRESS } from '../domain/ilo';
import { IloGState } from './IloGState';

function createGateway(): IloGateway & {
  bootstrap: ReturnType<typeof vi.fn>;
  listCards: ReturnType<typeof vi.fn>;
  taglibroDay: ReturnType<typeof vi.fn>;
  taglibroListEvents: ReturnType<typeof vi.fn>;
} {
  return {
    bootstrap: vi.fn().mockResolvedValue({
      progress: { ...EMPTY_ILO_PROGRESS },
      settings: { nativeLabel: 'russian', onboarded: true },
      themes: ['other'],
      train: { active: 0, card: null, due: 0 },
    }),
    createCard: vi.fn(),
    deleteCard: vi.fn(),
    deleteCards: vi.fn(),
    grade: vi.fn(),
    listCards: vi.fn().mockResolvedValue({ cards: [], nextOffset: null }),
    nextTrain: vi.fn(),
    progress: vi.fn(),
    taglibroBootstrap: vi.fn().mockResolvedValue({ events: [], timezone: 'Europe/Berlin', today: { date: '2026-01-01', diary: { mood: '🙂', planState: {}, text: '' }, plans: [] } }),
    taglibroDay: vi.fn() as unknown as IloGateway['taglibroDay'] & ReturnType<typeof vi.fn>,
    taglibroSavePlans: vi.fn(),
    taglibroSaveDiary: vi.fn(),
    taglibroSaveDay: vi.fn(),
    taglibroListEvents: vi.fn().mockResolvedValue({ events: [] }) as unknown as IloGateway['taglibroListEvents'] & ReturnType<typeof vi.fn>,
    taglibroCreateEvent: vi.fn(),
    taglibroUpdateEvent: vi.fn(),
    taglibroDeleteEvent: vi.fn(),
    updateCard: vi.fn(),
  };
}

describe('IloGState request reuse', () => {
  it('reuses a recent bootstrap when returning to the tool', async () => {
    const gateway = createGateway();
    const state = new IloGState(gateway);
    state.configure('owner-1');
    state.enter();
    await vi.waitFor(() => expect(gateway.bootstrap).toHaveBeenCalledOnce());

    state.exit();
    state.enter();
    await Promise.resolve();
    expect(gateway.bootstrap).toHaveBeenCalledOnce();

    await state.refresh();
    expect(gateway.bootstrap).toHaveBeenCalledTimes(2);
  });

  it('deduplicates the same dictionary page but allows an explicit refresh', async () => {
    const gateway = createGateway();
    const state = new IloGState(gateway);
    state.configure('owner-1');

    await state.searchCards('  ', '');
    await state.searchCards('', '');
    expect(gateway.listCards).toHaveBeenCalledOnce();

    await state.searchCards('', '', true);
    expect(gateway.listCards).toHaveBeenCalledTimes(2);
  });

  it('deduplicates day reads without cancelling an independent events request', async () => {
    const gateway = createGateway();
    let resolveDay!: (day: Awaited<ReturnType<IloGateway['taglibroDay']>>) => void;
    gateway.taglibroDay.mockReturnValueOnce(new Promise((resolve) => { resolveDay = resolve; }));
    const state = new IloGState(gateway);
    state.configure('owner-1');

    const firstDay = state.loadTaglibroDay('2026-01-02');
    const secondDay = state.loadTaglibroDay('2026-01-02');
    expect(gateway.taglibroDay).toHaveBeenCalledOnce();

    await state.loadTaglibroEvents();
    expect(gateway.taglibroListEvents).toHaveBeenCalledOnce();
    resolveDay({ date: '2026-01-02', diary: { mood: '🙂', planState: {}, text: '' }, plans: [] });
    await Promise.all([firstDay, secondDay]);
    expect(state.snapshot.taglibro.calendar?.date).toBe('2026-01-02');
  });

  it('keeps failed event loads retryable', async () => {
    const gateway = createGateway();
    gateway.taglibroListEvents
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ events: [] });
    const state = new IloGState(gateway);
    state.configure('owner-1');

    await state.loadTaglibroEvents(false, true);
    expect(state.snapshot.taglibro.eventsLoaded).toBe(false);
    expect(state.snapshot.taglibro.eventsLoading).toBe(false);
    await state.loadTaglibroEvents(false);
    expect(gateway.taglibroListEvents).toHaveBeenCalledTimes(2);
    expect(state.snapshot.taglibro.eventsLoaded).toBe(true);
  });
});
