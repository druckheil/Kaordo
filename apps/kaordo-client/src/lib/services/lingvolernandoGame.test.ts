import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_LINGVOLERNANDO_GAME } from '../domain/lingvolernando';
import {
  LINGVOLERNANDO_ACHIEVEMENTS,
  LINGVOLERNANDO_ARTIFACTS,
  LINGVOLERNANDO_WORLD,
  activeSynergies,
  completeLingvolernandoAction,
  completeLingvolernandoJourneyRecall,
  equipLingvolernandoArtifact,
  evolveLingvolernandoArtifact,
  journeyWordForGame,
  lingvolernandoBonuses,
  LINGVOLERNANDO_JOURNEY_INTERVAL_MS,
  readLingvolernandoGame,
  recordLingvolernandoTrainingAnswer,
  syncLingvolernandoCardCount,
  writeLingvolernandoGame,
} from './lingvolernandoGame';

const metrics = { activeCards: 18, activeDays: 4, serverXp: 90, stagePeak: 3, todayPoints: 12 };

describe('Lingvolernando game engine', () => {
  beforeEach(() => localStorage.clear());

  it('ships deep bounded catalogues without remote data', () => {
    expect(LINGVOLERNANDO_ARTIFACTS).toHaveLength(120);
    expect(new Set(LINGVOLERNANDO_ARTIFACTS.map((item) => `${item.form}:${item.material}`))).toHaveLength(120);
    expect(new Set(LINGVOLERNANDO_ARTIFACTS.map((item) => item.animationIndex))).toHaveLength(120);
    expect(LINGVOLERNANDO_WORLD).toHaveLength(120);
    expect(new Set(LINGVOLERNANDO_WORLD.map((item) => item.id))).toHaveLength(120);
    expect(LINGVOLERNANDO_ACHIEVEMENTS).toHaveLength(120);
    expect(new Set(LINGVOLERNANDO_ACHIEVEMENTS.map((item) => item.path))).toHaveLength(6);
  });

  it('creates rewards only at dynamic ten-remembered and twenty-forgotten thresholds', () => {
    const word = { german: 'vermindern', id: 'card-1', stage: 3, translation: 'to reduce' };
    let remembered = structuredClone(EMPTY_LINGVOLERNANDO_GAME);
    for (let index = 0; index < 9; index += 1) {
      const result = recordLingvolernandoTrainingAnswer(remembered, metrics, word, 'remember', 1_000 + index);
      remembered = result.game;
      expect(result.outcome).toBeNull();
    }
    const rememberedPulse = recordLingvolernandoTrainingAnswer(remembered, metrics, word, 'remember', 1_010);
    expect(rememberedPulse.outcome?.source).toBe('remembered');
    expect(rememberedPulse.game.actionCount).toBe(1);
    expect(rememberedPulse.game.learning.rememberedTowardAction).toBe(0);

    let forgotten = structuredClone(EMPTY_LINGVOLERNANDO_GAME);
    for (let index = 0; index < 19; index += 1) {
      const result = recordLingvolernandoTrainingAnswer(forgotten, metrics, word, 'forgot', 2_000 + index);
      forgotten = result.game;
      expect(result.outcome).toBeNull();
    }
    const forgottenPulse = recordLingvolernandoTrainingAnswer(forgotten, metrics, word, 'forgot', 2_020);
    expect(forgottenPulse.outcome?.source).toBe('forgotten');
    expect(forgottenPulse.game.actionCount).toBe(1);
    expect(forgottenPulse.game.learning.forgottenTowardAction).toBe(0);
  });

  it('stores acquisition time and persists progress per account', () => {
    const acquiredAt = 1_750_000_000_000;
    const result = completeLingvolernandoAction(structuredClone(EMPTY_LINGVOLERNANDO_GAME), metrics, 'remembered', acquiredAt);
    expect(result.outcome.xp).toBeGreaterThan(0);
    expect(result.outcome.artifactId).toBeTruthy();
    expect(result.game.actionCount).toBe(1);
    expect(result.game.discoveredArtifactIds).toContain(result.outcome.artifactId);
    expect(result.game.artifactDiscoveredAt[result.outcome.artifactId!]).toBe(acquiredAt);
    for (const artifactId of result.outcome.achievementRewardArtifactIds) {
      expect(result.game.artifactDiscoveredAt[artifactId]).toBe(acquiredAt);
    }

    writeLingvolernandoGame('alice', result.game);
    expect(readLingvolernandoGame('alice')).toEqual(result.game);
    expect(readLingvolernandoGame('bob').actionCount).toBe(0);
  });

  it('protects against empty streaks and converts duplicate draws into evolution dust', () => {
    const game = structuredClone(EMPTY_LINGVOLERNANDO_GAME);
    game.actionCount = 4;
    game.pity = 2;
    game.discoveredArtifactIds = ['relic-1'];
    game.artifactLevels = { 'relic-1': 1 };
    const result = completeLingvolernandoAction(game, { ...metrics, serverXp: 0 });
    expect(result.outcome.artifactId).toBe('relic-1');
    expect(result.outcome.artifactWasDuplicate).toBe(true);
    expect(result.outcome.dustEarned).toBeGreaterThan(0);
    expect(result.game.artifactLevels['relic-1']).toBeGreaterThanOrEqual(2);
  });

  it('uses a separate hourly Journey queue without repeating a word inside a round', () => {
    const start = 5_000_000;
    const game = structuredClone(EMPTY_LINGVOLERNANDO_GAME);
    game.journey.words = [
      { eligibleAt: 0, german: 'Weg', id: 'a', lastJourneyAt: null, remembered: 0, stage: 5, translation: 'path' },
      { eligibleAt: 0, german: 'Licht', id: 'b', lastJourneyAt: null, remembered: 0, stage: 5, translation: 'light' },
    ];
    game.journey.remainingWordIds = ['a', 'b'];

    expect(journeyWordForGame(game, start)?.id).toBe('a');
    const first = completeLingvolernandoJourneyRecall(game, metrics, true, start);
    expect(first.game.journey.position).toBe(1);
    expect(first.game.journey.remainingWordIds).toEqual(['b']);
    expect(journeyWordForGame(first.game, start + LINGVOLERNANDO_JOURNEY_INTERVAL_MS - 1)).toBeNull();
    expect(journeyWordForGame(first.game, start + LINGVOLERNANDO_JOURNEY_INTERVAL_MS)?.id).toBe('b');

    const secondAt = start + LINGVOLERNANDO_JOURNEY_INTERVAL_MS;
    const second = completeLingvolernandoJourneyRecall(first.game, metrics, false, secondAt);
    expect(second.game.journey.position).toBe(0);
    expect(second.game.journey.roundsCompleted).toBe(1);
    expect(journeyWordForGame(second.game, secondAt + LINGVOLERNANDO_JOURNEY_INTERVAL_MS)?.id).toBe('a');
  });

  it('supports three-slot loadouts, synergies, and explicit evolution', () => {
    let game = structuredClone(EMPTY_LINGVOLERNANDO_GAME);
    game.discoveredArtifactIds = ['relic-1', 'relic-2', 'relic-4'];
    game.artifactLevels = { 'relic-1': 1, 'relic-2': 1, 'relic-4': 1 };
    game = equipLingvolernandoArtifact(game, 'relic-1', 0);
    game = equipLingvolernandoArtifact(game, 'relic-4', 1);
    game = equipLingvolernandoArtifact(game, 'relic-2', 2);
    expect(activeSynergies(game.equippedArtifactIds).map((item) => item.id)).toContain('deep-flow');
    expect(lingvolernandoBonuses(game).xpPercent).toBeGreaterThan(0);

    game.artifactDust = 50;
    const evolved = evolveLingvolernandoArtifact(game, 'relic-1');
    expect(evolved.artifactLevels['relic-1']).toBe(2);
    expect(evolved.artifactDust).toBeLessThan(50);
  });

  it('uses the first card count as a baseline and counts the first later addition', () => {
    const emptyLibrary = syncLingvolernandoCardCount(structuredClone(EMPTY_LINGVOLERNANDO_GAME), 0);
    expect(emptyLibrary.learning.cardCountInitialized).toBe(true);
    expect(emptyLibrary.learning.addedWords).toBe(0);

    const firstWord = syncLingvolernandoCardCount(emptyLibrary, 1);
    expect(firstWord.learning.knownCardCount).toBe(1);
    expect(firstWord.learning.addedWords).toBe(1);
    expect(firstWord.learning.newWordsTowardBloom).toBe(1);
  });

  it('reveals at most one achievement from each path per learning pulse', () => {
    const game = structuredClone(EMPTY_LINGVOLERNANDO_GAME);
    game.actionCount = 50_000;
    game.learning.rememberedAnswers = 50_000;
    game.discoveredArtifactIds = LINGVOLERNANDO_ARTIFACTS.slice(0, 100).map((artifact) => artifact.id);
    game.discoveredWorldIds = LINGVOLERNANDO_WORLD.slice(0, 100).map((element) => element.id);
    const result = completeLingvolernandoAction(game, {
      activeCards: 50_000,
      activeDays: 50_000,
      serverXp: 50_000,
      stagePeak: 8,
      todayPoints: 50_000,
    });
    const claimed = result.outcome.newlyClaimedAchievementIds
      .map((id) => LINGVOLERNANDO_ACHIEVEMENTS.find((achievement) => achievement.id === id))
      .filter((achievement) => achievement !== undefined);

    expect(claimed.length).toBeLessThanOrEqual(6);
    expect(new Set(claimed.map((achievement) => achievement.path)).size).toBe(claimed.length);
  });
});
