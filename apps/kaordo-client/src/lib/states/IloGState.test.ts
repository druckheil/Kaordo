import { describe, expect, it, vi } from 'vitest';
import type { IloGateway } from '../gateways/IloGateway';
import { EMPTY_ILO_PROGRESS } from '../domain/ilo';
import { IloGState } from './IloGState';

function createGateway(): IloGateway & {
  bootstrap: ReturnType<typeof vi.fn>;
  listCards: ReturnType<typeof vi.fn>;
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
    taglibroDay: vi.fn(),
    taglibroSavePlans: vi.fn(),
    taglibroSaveDiary: vi.fn(),
    taglibroSaveDay: vi.fn(),
    taglibroListEvents: vi.fn().mockResolvedValue({ events: [] }),
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
});
