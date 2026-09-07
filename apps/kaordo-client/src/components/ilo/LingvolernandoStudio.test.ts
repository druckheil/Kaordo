import { fireEvent, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IloSnapshot } from '../../lib/domain/ilo';
import { EMPTY_LINGVOLERNANDO_GAME, type LingvolernandoRewardOutcome } from '../../lib/domain/lingvolernando';
import type { IloGState } from '../../lib/states/IloGState';
import LingvolernandoStudio from './LingvolernandoStudio.svelte';

function snapshot(): IloSnapshot {
  return {
    busy: null,
    cards: [],
    cardsHasMore: false,
    cardsLoaded: true,
    cardsLoading: false,
    error: null,
    lingvolernando: structuredClone(EMPTY_LINGVOLERNANDO_GAME),
    logs: [],
    phase: 'ready',
    progress: {
      active: 24,
      due: 5,
      learnedToday: false,
      pointsHistory: [
        { date: '2026-09-01', points: 8 },
        { date: '2026-09-02', points: 0 },
        { date: '2026-09-03', points: 12 },
      ],
      stages: { '0': 4, '1': 8, '2': 6, '3': 6 },
      todayPoints: 12,
    },
    refreshing: false,
    settings: { nativeLabel: 'russian', onboarded: true },
    taglibro: {
      bootstrap: null,
      busy: null,
      calendar: null,
      error: null,
      events: [],
      eventsLoaded: false,
      eventsLoading: false,
      eventsIncludePast: false,
      phase: 'idle',
      refreshing: false,
      selectedDate: '',
    },
    themes: [],
    train: {
      active: 24,
      card: {
        answerLines: ['to reduce'],
        id: 'card-1',
        promptText: 'vermindern',
        promptTitle: 'vermindern',
        stage: 2,
        task: 'de_to_native',
      },
      due: 5,
    },
  };
}

function gameState(outcome: LingvolernandoRewardOutcome | null = null): IloGState {
  return {
    answerLingvolernandoJourney: vi.fn(() => outcome),
    equipLingvolernandoArtifact: vi.fn(),
    evolveLingvolernandoArtifact: vi.fn(),
    renameLingvolernandoPet: vi.fn(),
    selectLingvolernandoBiome: vi.fn(),
    setLingvolernandoPetPalette: vi.fn(),
    toggleLingvolernandoPetArtifact: vi.fn(),
  } as unknown as IloGState;
}

describe('Lingvolernando game space', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stays language-only and mounts one spatial room at a time', async () => {
    const view = render(LingvolernandoStudio, { gameState: gameState(), onOpenTrain: vi.fn(), snapshot: snapshot() });

    expect(view.getByRole('heading', { name: 'Every word changes this place.' })).toBeTruthy();
    expect(view.queryByText('Drawing')).toBeNull();
    expect(view.queryByText('Writing')).toBeNull();

    await fireEvent.click(view.getByRole('button', { name: /Living world.*permanent boosts/ }));
    expect(view.getByRole('heading', { name: 'A world that explains your progress' })).toBeTruthy();
    expect(view.queryByRole('heading', { name: 'Every word changes this place.' })).toBeNull();

    await fireEvent.click(view.getByRole('button', { name: 'Return to Lingvolernando home' }));
    expect(view.getByRole('heading', { name: 'Every word changes this place.' })).toBeTruthy();
  });

  it('turns an hourly long-memory answer into a dismissible reward sequence', async () => {
    const outcome: LingvolernandoRewardOutcome = {
      achievementRewardArtifactIds: ['relic-1'],
      artifactId: 'relic-1',
      artifactLevel: 1,
      artifactWasDuplicate: false,
      dustEarned: 0,
      newlyClaimedAchievementIds: ['achievement-1-1'],
      rarity: 'common',
      sequenceId: 'sequence-1',
      source: 'journey',
      synergyIds: [],
      worldElementId: 'world-1',
      xp: 31,
    };
    const state = gameState(outcome);
    const readySnapshot = snapshot();
    readySnapshot.lingvolernando.journey.words = [{
      eligibleAt: 0,
      german: 'vermindern',
      id: 'card-1',
      lastJourneyAt: null,
      remembered: 0,
      stage: 5,
      translation: 'to reduce',
    }];
    readySnapshot.lingvolernando.journey.remainingWordIds = ['card-1'];
    const view = render(LingvolernandoStudio, { gameState: state, onOpenTrain: vi.fn(), snapshot: readySnapshot });

    await fireEvent.click(view.getByRole('button', { name: /Memory trail.*old word is waiting/i }));
    await fireEvent.click(view.getByRole('button', { name: 'Reveal meaning' }));
    await fireEvent.click(view.getByRole('button', { name: /I remembered/ }));
    expect(state.answerLingvolernandoJourney).toHaveBeenCalledWith(true);
    expect(view.getByRole('dialog')).toBeTruthy();
    expect(view.getByRole('heading', { name: 'Moonstone Compass' })).toBeTruthy();
    expect(view.getAllByText('Recall Fern')).not.toHaveLength(0);

    await fireEvent.click(view.getByRole('button', { name: 'Return to Lingvolernando' }));
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('exposes the paged reward vault and six-path milestone atlas', async () => {
    const view = render(LingvolernandoStudio, { gameState: gameState(), onOpenTrain: vi.fn(), snapshot: snapshot() });
    await fireEvent.click(view.getByRole('button', { name: /Vault.*120 artifacts/ }));
    expect(view.getByRole('heading', { name: 'Build a language constellation' })).toBeTruthy();
    expect(view.getByText('0/120 forms awakened')).toBeTruthy();

    await fireEvent.click(view.getByRole('button', { name: /Achievement atlas/ }));
    expect(view.getByText('Six paths, 120 milestones')).toBeTruthy();
    expect(view.getByText('Twenty permanent landmarks')).toBeTruthy();
  });
});
