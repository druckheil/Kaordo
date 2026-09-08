import type { IloProgress } from '../domain/ilo';
import {
  EMPTY_LINGVOLERNANDO_GAME,
  type LingvolernandoAchievementDefinition,
  type LingvolernandoAchievementMetric,
  type LingvolernandoArtifactDefinition,
  type LingvolernandoArtifactModifier,
  type LingvolernandoArtifactRarity,
  type LingvolernandoArtifactTrait,
  type LingvolernandoGameBonuses,
  type LingvolernandoGameSnapshot,
  type LingvolernandoJourneyWord,
  type LingvolernandoPetPalette,
  type LingvolernandoRewardOutcome,
  type LingvolernandoSynergyDefinition,
  type LingvolernandoWorldElementDefinition,
} from '../domain/lingvolernando';

const STORAGE_VERSION = 3;
export const LINGVOLERNANDO_JOURNEY_INTERVAL_MS = 60 * 60 * 1_000;
const JOURNEY_MATURE_STAGE = 5;
const NEW_WORD_BLOOM_TARGET = 4;
const LEGACY_PROGRESS_KEY = 'kaordo.lingvolernando.progress.v1';
const LEGACY_RELICS_KEY = 'kaordo.lingvolernando.relics';

const materials = [
  { name: 'Moonstone', accent: '#7469ea', modifier: 'lunar' },
  { name: 'Sage glass', accent: '#35a98c', modifier: 'garden' },
  { name: 'Amber thread', accent: '#d4954f', modifier: 'solar' },
  { name: 'Rose quartz', accent: '#c96f91', modifier: 'crystal' },
  { name: 'Sky enamel', accent: '#5595cf', modifier: 'prism' },
  { name: 'Ink pearl', accent: '#596781', modifier: 'void' },
  { name: 'Aurora foil', accent: '#43acb7', modifier: 'aurora' },
  { name: 'Ember clay', accent: '#cb6658', modifier: 'echo' },
  { name: 'Frost crystal', accent: '#7db5df', modifier: 'crystal' },
  { name: 'Velvet moss', accent: '#71966b', modifier: 'garden' },
  { name: 'Solar brass', accent: '#d3ad43', modifier: 'solar' },
  { name: 'Cloud ceramic', accent: '#9aa9c8', modifier: 'prism' },
] as const satisfies ReadonlyArray<{ accent: string; modifier: LingvolernandoArtifactModifier; name: string }>;

const forms = [
  { name: 'Compass', description: 'Turns scattered examples into a direction you can follow.' },
  { name: 'Lantern', description: 'Keeps a difficult word visible at the edge of memory.' },
  { name: 'Seed', description: 'Grows one small return into a durable language habit.' },
  { name: 'Feather', description: 'Makes a sentence feel lighter when you try it aloud.' },
  { name: 'Key', description: 'Opens a connection between meaning, sound, and context.' },
  { name: 'Spindle', description: 'Threads related words into a pattern worth keeping.' },
  { name: 'Orb', description: 'Stores the glow of a recall that arrived without help.' },
  { name: 'Bell', description: 'Marks the instant a phrase begins to feel natural.' },
  { name: 'Leaf', description: 'Preserves a word exactly where you first understood it.' },
  { name: 'Wing', description: 'Carries a familiar construction into a new sentence.' },
] as const;

const traits: LingvolernandoArtifactTrait[] = [
  'focus', 'momentum', 'context', 'memory', 'curiosity', 'precision',
];

function rarityFor(index: number): LingvolernandoArtifactRarity {
  if ((index + 1) % 31 === 0) return 'mythic';
  if ((index + 3) % 13 === 0) return 'epic';
  if ((index + 1) % 4 === 0) return 'rare';
  return 'common';
}

/** 120 deliberately distinct material/form/trait combinations. */
export const LINGVOLERNANDO_ARTIFACTS: readonly LingvolernandoArtifactDefinition[] = Array.from(
  { length: 120 },
  (_, index) => {
    const material = materials[index % materials.length]!;
    const form = forms[Math.floor(index / materials.length)]!;
    const trait = traits[index % traits.length]!;
    const secondaryTrait = traits[(index * 5 + 3) % traits.length] === trait
      ? traits[(index + 1) % traits.length]!
      : traits[(index * 5 + 3) % traits.length]!;
    const rarity = rarityFor(index);
    const rarityPower = rarity === 'mythic' ? 6 : rarity === 'epic' ? 4 : rarity === 'rare' ? 2 : 0;
    return {
      accent: material.accent,
      animationIndex: index,
      description: form.description,
      form: Math.floor(index / materials.length),
      id: `relic-${index + 1}`,
      material: material.name,
      modifier: material.modifier,
      name: `${material.name} ${form.name}`,
      rarity,
      secondaryTrait,
      secondaryValue: 2 + ((index * 3) % 5) + Math.floor(rarityPower / 2),
      trait,
      unlockAt: index === 0 ? 0 : 24 + index * 52,
      value: 3 + ((index * 7) % 7) + rarityPower,
    };
  },
);

export const LINGVOLERNANDO_BIOMES = [
  { id: 'meadow', name: 'Word Meadow', subtitle: 'Meanings take root here.', accent: '#36a789', unlockAt: 0 },
  { id: 'canopy', name: 'Memory Canopy', subtitle: 'Old words return in new light.', accent: '#6e9d70', unlockAt: 260 },
  { id: 'river', name: 'Context River', subtitle: 'Sentences move instead of standing still.', accent: '#4b98c8', unlockAt: 560 },
  { id: 'archive', name: 'Echo Archive', subtitle: 'Sound and meaning leave a trace.', accent: '#7a6de4', unlockAt: 920 },
  { id: 'observatory', name: 'Syntax Observatory', subtitle: 'Patterns become constellations.', accent: '#bd7a9c', unlockAt: 1_340 },
  { id: 'night', name: 'Night Garden', subtitle: 'Rare phrases wake after dark.', accent: '#596481', unlockAt: 1_820 },
] as const;

const worldNouns = [
  'Recall Fern', 'Meaning Moth', 'Context Stone', 'Listening Reed', 'Phrase Pond',
  'Verb Vine', 'Accent Fox', 'Example Bridge', 'Fluency Star', 'Question Kite',
  'Grammar Gate', 'Curiosity Bird', 'Sound Lantern', 'Sentence Path', 'Idiom Shell',
  'Reading Grove', 'Translation Well', 'Memory Loom', 'Story Beacon', 'Dialogue Tree',
] as const;

const worldKinds = ['flora', 'creature', 'landmark', 'phenomenon', 'workshop'] as const;
const worldPositions = [
  [11, 68], [22, 33], [34, 73], [47, 25], [60, 67],
  [76, 36], [88, 70], [17, 84], [30, 51], [43, 86],
  [57, 46], [70, 83], [84, 52], [12, 20], [28, 16],
  [44, 58], [61, 17], [74, 61], [89, 21], [52, 78],
] as const;
const worldEffects = [
  'Permanent effect: +1% XP from every completed learning pulse.',
  'Permanent effect: +1 percentage point to artifact discovery chance.',
  'Permanent effect: +2% artifact dust from duplicate discoveries.',
  'Permanent effect: +2% world light from completed learning pulses.',
  'Permanent effect: +1% XP and a brighter correct-answer reaction.',
  'Permanent effect: +1 percentage point to artifact discovery chance.',
  'Permanent effect: +2% artifact dust from duplicate discoveries.',
  'Permanent effect: +2% world light from completed learning pulses.',
  'Permanent effect: +1% XP from every completed learning pulse.',
  'Permanent effect: +1 percentage point to artifact discovery chance.',
  'Permanent effect: +2% artifact dust from duplicate discoveries.',
  'Permanent effect: +2% world light from completed learning pulses.',
  'Permanent effect: +1% XP and a richer world reaction.',
  'Permanent effect: +1 percentage point to artifact discovery chance.',
  'Permanent effect: +2% artifact dust from duplicate discoveries.',
  'Permanent effect: +2% world light from completed learning pulses.',
  'Permanent effect: +1% XP from every completed learning pulse.',
  'Permanent effect: +1 percentage point to artifact discovery chance.',
  'Permanent effect: +2% artifact dust from duplicate discoveries.',
  'Permanent effect: +2% world light from completed learning pulses.',
] as const;

/** Six biomes with twenty useful, inspectable elements each. */
export const LINGVOLERNANDO_WORLD: readonly LingvolernandoWorldElementDefinition[] = LINGVOLERNANDO_BIOMES.flatMap(
  (biome, biomeIndex) => worldNouns.map((noun, localIndex) => {
    const index = biomeIndex * worldNouns.length + localIndex;
    const position = worldPositions[localIndex]!;
    return {
      accent: biome.accent,
      biome: biome.id,
      description: `${noun} belongs to ${biome.name} and changes as your German becomes more connected.`,
      effect: worldEffects[localIndex]!,
      id: `world-${index + 1}`,
      kind: worldKinds[(localIndex + biomeIndex) % worldKinds.length]!,
      name: biomeIndex === 0 ? noun : `${biome.name.split(' ')[0]} ${noun}`,
      sprite: localIndex,
      unlockAt: biome.unlockAt + localIndex * 18,
      x: position[0],
      y: position[1],
    };
  }),
);

const achievementPaths: Array<{
  accent: string;
  metric: LingvolernandoAchievementMetric;
  name: string;
  targets: number[];
}> = [
  { name: 'Return', metric: 'actions', accent: '#7469ea', targets: [1, 2, 3, 5, 8, 12, 18, 25, 35, 50, 70, 95, 125, 160, 210, 270, 350, 450, 600, 800] },
  { name: 'Lexicon', metric: 'cards', accent: '#35a98c', targets: [5, 10, 15, 20, 30, 40, 55, 70, 90, 115, 145, 180, 220, 270, 330, 400, 480, 580, 700, 850] },
  { name: 'Rhythm', metric: 'days', accent: '#d4954f', targets: [1, 2, 3, 4, 5, 7, 9, 12, 15, 20, 26, 33, 42, 52, 65, 80, 100, 125, 160, 200] },
  { name: 'Vault', metric: 'artifacts', accent: '#c96f91', targets: [1, 2, 3, 4, 5, 7, 9, 12, 15, 19, 24, 30, 37, 45, 54, 64, 76, 90, 105, 120] },
  { name: 'World', metric: 'world', accent: '#5595cf', targets: [1, 2, 3, 4, 5, 7, 9, 12, 15, 19, 24, 30, 37, 45, 54, 64, 76, 90, 105, 120] },
  { name: 'Recall', metric: 'remembered', accent: '#43acb7', targets: [10, 20, 35, 50, 75, 100, 140, 185, 240, 310, 390, 480, 590, 720, 870, 1_040, 1_240, 1_480, 1_760, 2_100] },
];
const achievementRanks = [
  'First signal', 'Small spark', 'Open path', 'Quiet rhythm', 'Steady hand',
  'Clear echo', 'Growing light', 'Known route', 'Deep roots', 'Bright current',
  'Long orbit', 'Living pattern', 'Wide horizon', 'Rare shape', 'Strong memory',
  'Night signal', 'Hidden chamber', 'Fluent current', 'Master archive', 'Endless garden',
] as const;

/** 120 milestones spread over six progress paths; only one path is rendered at a time. */
export const LINGVOLERNANDO_ACHIEVEMENTS: readonly LingvolernandoAchievementDefinition[] = achievementPaths.flatMap(
  (path, pathIndex) => path.targets.map((target, tierIndex) => ({
    accent: path.accent,
    description: `Reach ${target} ${path.metric === 'actions' ? 'learning pulses' : path.metric} and reveal a permanent ${path.name.toLowerCase()} landmark plus its artifact reward.`,
    id: `achievement-${pathIndex + 1}-${tierIndex + 1}`,
    metric: path.metric,
    name: `${path.name}: ${achievementRanks[tierIndex]}`,
    path: path.name,
    rewardArtifactId: `relic-${((pathIndex * 20 + tierIndex) % LINGVOLERNANDO_ARTIFACTS.length) + 1}`,
    target,
    tier: tierIndex + 1,
  })),
);

export const LINGVOLERNANDO_SYNERGIES: readonly LingvolernandoSynergyDefinition[] = [
  { id: 'deep-flow', name: 'Deep Flow', description: 'Focus and momentum reinforce each other after every completed learning pulse.', accent: '#7469ea', requiredTraits: { focus: 2, momentum: 1 } },
  { id: 'living-context', name: 'Living Context', description: 'Examples and memory cues begin to behave like one connected map.', accent: '#35a98c', requiredTraits: { context: 2, memory: 1 } },
  { id: 'precise-echo', name: 'Precise Echo', description: 'Sound, spelling, and recall align into a cleaner signal.', accent: '#5595cf', requiredTraits: { precision: 2, memory: 1 } },
  { id: 'curious-orbit', name: 'Curious Orbit', description: 'Luma searches the world more often after learning pulses.', accent: '#43acb7', requiredTraits: { curiosity: 2, momentum: 1 } },
  { id: 'rooted-attention', name: 'Rooted Attention', description: 'Context keeps focus stable when the review queue grows.', accent: '#71966b', requiredTraits: { context: 1, focus: 2 } },
  { id: 'memory-engine', name: 'Memory Engine', description: 'Precision turns repeated recalls into stronger long-term traces.', accent: '#c96f91', requiredTraits: { memory: 2, precision: 1 } },
  { id: 'explorer-signal', name: 'Explorer Signal', description: 'Curiosity and context reveal world silhouettes sooner.', accent: '#d4954f', requiredTraits: { curiosity: 2, context: 1 } },
  { id: 'quiet-velocity', name: 'Quiet Velocity', description: 'Momentum rises without making the interface louder.', accent: '#596781', requiredTraits: { momentum: 2, precision: 1 } },
];

// Catalogs are generated once and then read on every render, answer and
// persistence pass. Keeping the indexes private prevents components from
// accidentally mutating the source data while avoiding repeated linear scans
// through the 120-item collections.
const ARTIFACT_BY_ID = new Map(LINGVOLERNANDO_ARTIFACTS.map((artifact) => [artifact.id, artifact]));
const WORLD_BY_ID = new Map(LINGVOLERNANDO_WORLD.map((element) => [element.id, element]));
const ACHIEVEMENT_BY_ID = new Map(LINGVOLERNANDO_ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));
const WORLD_INDEX_BY_ID = new Map(LINGVOLERNANDO_WORLD.map((element, index) => [element.id, index]));
const ARTIFACT_IDS = new Set(ARTIFACT_BY_ID.keys());
const WORLD_IDS = new Set(WORLD_BY_ID.keys());
const ACHIEVEMENT_IDS = new Set(ACHIEVEMENT_BY_ID.keys());
const VALID_MOODS = new Set<LingvolernandoGameSnapshot['pet']['mood']>(['curious', 'dreaming', 'focused', 'glowing', 'resting']);
const VALID_PALETTES = new Set<LingvolernandoPetPalette>(['aurora', 'ember', 'moon', 'moss']);
const ACHIEVEMENTS_BY_PATH = new Map<string, LingvolernandoAchievementDefinition[]>();
for (const achievement of LINGVOLERNANDO_ACHIEVEMENTS) {
  const path = ACHIEVEMENTS_BY_PATH.get(achievement.path) ?? [];
  path.push(achievement);
  ACHIEVEMENTS_BY_PATH.set(achievement.path, path);
}

export function lingvolernandoArtifact(id: string | null | undefined): LingvolernandoArtifactDefinition | null {
  return id ? ARTIFACT_BY_ID.get(id) ?? null : null;
}

export function lingvolernandoWorldElement(id: string | null | undefined): LingvolernandoWorldElementDefinition | null {
  return id ? WORLD_BY_ID.get(id) ?? null : null;
}

export function lingvolernandoAchievement(id: string | null | undefined): LingvolernandoAchievementDefinition | null {
  return id ? ACHIEVEMENT_BY_ID.get(id) ?? null : null;
}

export function lingvolernandoAchievementsForPath(path: string): readonly LingvolernandoAchievementDefinition[] {
  return ACHIEVEMENTS_BY_PATH.get(path) ?? [];
}

export type LingvolernandoProgressMetrics = {
  activeCards: number;
  activeDays: number;
  serverXp: number;
  stagePeak: number;
  todayPoints: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function fraction(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  const value = Math.abs(Math.sin(seed * 12.9898 + 78.233) * 43_758.5453);
  return value - Math.floor(value);
}

function pickIndex(seed: number, length: number): number {
  return length > 0 ? Math.floor(fraction(seed) * length) % length : 0;
}

function rarityDust(rarity: LingvolernandoArtifactRarity): number {
  if (rarity === 'mythic') return 28;
  if (rarity === 'epic') return 16;
  if (rarity === 'rare') return 9;
  return 5;
}

export function metricsFromProgress(progress: IloProgress): LingvolernandoProgressMetrics {
  let activeDays = 0;
  let serverXp = 0;
  const pointsHistory = Array.isArray(progress.pointsHistory) ? progress.pointsHistory : [];
  for (const item of pointsHistory) {
    const points = typeof item.points === 'number' && Number.isFinite(item.points) ? item.points : 0;
    if (points > 0) activeDays += 1;
    serverXp += Math.max(0, points);
  }
  let stagePeak = 0;
  const stages = progress.stages && typeof progress.stages === 'object' ? progress.stages : {};
  for (const [stage, count] of Object.entries(stages)) {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    const numericStage = Number(stage);
    if (Number.isFinite(numericStage)) stagePeak = Math.max(stagePeak, numericStage);
  }
  const activeCards = typeof progress.active === 'number' && Number.isFinite(progress.active) ? progress.active : 0;
  const todayPoints = typeof progress.todayPoints === 'number' && Number.isFinite(progress.todayPoints) ? progress.todayPoints : 0;
  return {
    activeCards: Math.max(0, activeCards),
    activeDays,
    serverXp,
    stagePeak: Number.isFinite(stagePeak) ? stagePeak : 0,
    todayPoints: Math.max(0, todayPoints),
  };
}

export function achievementValue(
  achievement: LingvolernandoAchievementDefinition,
  game: Readonly<LingvolernandoGameSnapshot>,
  metrics: LingvolernandoProgressMetrics,
): number {
  switch (achievement.metric) {
    case 'actions': return game.actionCount;
    case 'artifacts': return game.discoveredArtifactIds.length;
    case 'cards': return metrics.activeCards;
    case 'days': return metrics.activeDays;
    case 'remembered': return game.learning.rememberedAnswers;
    case 'world': return game.discoveredWorldIds.length;
  }
}

export function activeSynergies(equippedIds: ReadonlyArray<string | null>): LingvolernandoSynergyDefinition[] {
  const traitCounts = new Map<LingvolernandoArtifactTrait, number>();
  for (const id of equippedIds) {
    const artifact = lingvolernandoArtifact(id);
    if (!artifact) continue;
    traitCounts.set(artifact.trait, (traitCounts.get(artifact.trait) ?? 0) + 1);
    traitCounts.set(artifact.secondaryTrait, (traitCounts.get(artifact.secondaryTrait) ?? 0) + 1);
  }
  return LINGVOLERNANDO_SYNERGIES.filter((synergy) => Object.entries(synergy.requiredTraits).every(
    ([trait, required]) => (traitCounts.get(trait as LingvolernandoArtifactTrait) ?? 0) >= (required ?? 0),
  ));
}

/** Actual cumulative effects of the equipped artifacts and awakened world. */
export function lingvolernandoBonuses(game: Readonly<LingvolernandoGameSnapshot>): LingvolernandoGameBonuses {
  const result: LingvolernandoGameBonuses = {
    artifactChancePercent: 0,
    dustPercent: 0,
    worldLightPercent: 0,
    xpPercent: 0,
  };
  for (const id of game.equippedArtifactIds) {
    const artifact = lingvolernandoArtifact(id);
    if (!artifact) continue;
    const level = clamp(
      Number.isFinite(game.artifactLevels[artifact.id]) ? game.artifactLevels[artifact.id]! : 1,
      1,
      99,
    );
    const primary = artifact.value + level - 1;
    const secondary = artifact.secondaryValue + Math.floor((level - 1) / 2);
    for (const [trait, value] of [[artifact.trait, primary], [artifact.secondaryTrait, secondary]] as const) {
      if (trait === 'focus' || trait === 'memory') result.xpPercent += Math.max(1, Math.ceil(value / (trait === 'focus' ? 2 : 4)));
      if (trait === 'curiosity') result.artifactChancePercent += Math.max(1, Math.ceil(value / 3));
      if (trait === 'precision') result.dustPercent += Math.max(1, value);
      if (trait === 'momentum' || trait === 'context') result.worldLightPercent += Math.max(1, Math.ceil(value / (trait === 'momentum' ? 2 : 4)));
    }
  }
  for (const id of game.discoveredWorldIds) {
    const index = WORLD_INDEX_BY_ID.get(id) ?? -1;
    if (index < 0) continue;
    if (index % 4 === 0) result.xpPercent += 1;
    else if (index % 4 === 1) result.artifactChancePercent += 1;
    else if (index % 4 === 2) result.dustPercent += 2;
    else result.worldLightPercent += 2;
  }
  for (const synergy of activeSynergies(game.equippedArtifactIds)) {
    if (synergy.id === 'deep-flow' || synergy.id === 'memory-engine') result.xpPercent += 5;
    if (synergy.id === 'curious-orbit' || synergy.id === 'explorer-signal') result.artifactChancePercent += 4;
    if (synergy.id === 'precise-echo' || synergy.id === 'quiet-velocity') result.dustPercent += 10;
    if (synergy.id === 'living-context' || synergy.id === 'rooted-attention') result.worldLightPercent += 8;
  }
  return {
    artifactChancePercent: clamp(result.artifactChancePercent, 0, 35),
    dustPercent: clamp(result.dustPercent, 0, 120),
    worldLightPercent: clamp(result.worldLightPercent, 0, 100),
    xpPercent: clamp(result.xpPercent, 0, 80),
  };
}

export function artifactEffectLabel(artifact: LingvolernandoArtifactDefinition, level = 1): string {
  const primary = artifact.value + Math.max(0, level - 1);
  if (artifact.trait === 'focus') return `+${Math.ceil(primary / 2)}% XP per completed learning pulse`;
  if (artifact.trait === 'memory') return `+${Math.ceil(primary / 4)}% XP from durable recall`;
  if (artifact.trait === 'curiosity') return `+${Math.ceil(primary / 3)} points to artifact discovery chance`;
  if (artifact.trait === 'precision') return `+${primary}% dust from duplicate artifacts`;
  if (artifact.trait === 'momentum') return `+${Math.ceil(primary / 2)}% world light per learning pulse`;
  return `+${Math.ceil(primary / 4)}% world light from connected context`;
}

export function completeLingvolernandoAction(
  current: Readonly<LingvolernandoGameSnapshot>,
  metrics: LingvolernandoProgressMetrics,
  source: LingvolernandoRewardOutcome['source'] = 'remembered',
  now = Date.now(),
): { game: LingvolernandoGameSnapshot; outcome: LingvolernandoRewardOutcome } {
  const nextActionCount = current.actionCount + 1;
  const bonuses = lingvolernandoBonuses(current);
  const baseXp = 24 + metrics.stagePeak * 2 + pickIndex(nextActionCount + metrics.activeCards, 5) * 3;
  const xp = Math.round(baseXp * (1 + bonuses.xpPercent / 100));
  const projectedXp = metrics.serverXp + current.earnedXp + xp;
  const shouldDrop = nextActionCount === 1 || current.pity >= 2 || fraction(projectedXp + nextActionCount * 17) < 0.28 + current.pity * 0.08 + bonuses.artifactChancePercent / 100;
  const discoveredArtifactSet = new Set(current.discoveredArtifactIds);
  const eligibleArtifacts = LINGVOLERNANDO_ARTIFACTS.filter((artifact) => artifact.unlockAt <= projectedXp);
  const undiscoveredArtifacts = eligibleArtifacts.filter((artifact) => !discoveredArtifactSet.has(artifact.id));
  const artifactPool = undiscoveredArtifacts.length > 0 ? undiscoveredArtifacts : eligibleArtifacts;
  const artifact = shouldDrop && artifactPool.length > 0
    ? artifactPool[pickIndex(projectedXp * 3 + nextActionCount, artifactPool.length)]!
    : null;
  const wasDuplicate = artifact ? discoveredArtifactSet.has(artifact.id) : false;
  const artifactLevels = { ...current.artifactLevels };
  const discoveredArtifactIds = [...current.discoveredArtifactIds];
  const artifactDiscoveredAt = { ...current.artifactDiscoveredAt };
  let dustEarned = 0;
  if (artifact) {
    if (!wasDuplicate) {
      discoveredArtifactIds.push(artifact.id);
      artifactDiscoveredAt[artifact.id] = now;
    }
    artifactLevels[artifact.id] = clamp((artifactLevels[artifact.id] ?? 0) + 1, 1, 99);
    if (wasDuplicate) dustEarned = Math.round(rarityDust(artifact.rarity) * (1 + bonuses.dustPercent / 100));
  }

  const baseWorldLight = 10 + Math.ceil(xp / 8);
  const nextWorldLight = current.worldLight + Math.round(baseWorldLight * (1 + bonuses.worldLightPercent / 100));
  const discoveredWorldSet = new Set(current.discoveredWorldIds);
  const worldCandidates = LINGVOLERNANDO_WORLD.filter(
    (element) => element.unlockAt <= nextWorldLight && !discoveredWorldSet.has(element.id),
  );
  const worldElement = worldCandidates[0] ?? null;
  const discoveredWorldIds = worldElement
    ? [...current.discoveredWorldIds, worldElement.id]
    : [...current.discoveredWorldIds];
  const baseGame: LingvolernandoGameSnapshot = {
    ...current,
    actionCount: nextActionCount,
    artifactDiscoveredAt,
    artifactDust: current.artifactDust + dustEarned,
    artifactLevels,
    discoveredArtifactIds,
    discoveredWorldIds,
    earnedXp: current.earnedXp + xp,
    lastActionAt: now,
    pet: {
      ...current.pet,
      mood: artifact?.rarity === 'mythic' || artifact?.rarity === 'epic' ? 'glowing' : 'focused',
    },
    pity: artifact && (artifact.rarity === 'rare' || artifact.rarity === 'epic' || artifact.rarity === 'mythic') ? 0 : Math.min(20, current.pity + 1),
    worldLight: nextWorldLight,
  };
  // Unlock at most one milestone from each path per pulse. Existing accounts
  // can have years of progress, but revealing dozens of rewards in a single
  // frame would destroy both the sense of progression and reward clarity.
  const claimedAchievementSet = new Set(baseGame.claimedAchievementIds);
  const newlyClaimed = [...ACHIEVEMENTS_BY_PATH.values()].flatMap((pathAchievements) => {
    const next = pathAchievements.find((achievement) => !claimedAchievementSet.has(achievement.id));
    return next && achievementValue(next, baseGame, metrics) >= next.target ? [next.id] : [];
  });
  const achievementClaimedAt = { ...baseGame.achievementClaimedAt };
  const achievementRewardArtifactIds: string[] = [];
  for (const achievementId of newlyClaimed) {
    achievementClaimedAt[achievementId] = now;
    const rewardId = ACHIEVEMENT_BY_ID.get(achievementId)?.rewardArtifactId;
    if (!rewardId) continue;
    achievementRewardArtifactIds.push(rewardId);
    const reward = ARTIFACT_BY_ID.get(rewardId);
    if (!reward) continue;
    if (!discoveredArtifactIds.includes(rewardId)) {
      discoveredArtifactIds.push(rewardId);
      artifactDiscoveredAt[rewardId] = now;
    } else {
      dustEarned += Math.round(rarityDust(reward.rarity) * (1 + bonuses.dustPercent / 100));
    }
    artifactLevels[rewardId] = clamp((artifactLevels[rewardId] ?? 0) + 1, 1, 99);
  }
  const game: LingvolernandoGameSnapshot = {
    ...baseGame,
    achievementClaimedAt,
    artifactDiscoveredAt,
    artifactDust: current.artifactDust + dustEarned,
    artifactLevels,
    claimedAchievementIds: [...baseGame.claimedAchievementIds, ...newlyClaimed],
    discoveredArtifactIds,
  };
  const synergies = activeSynergies(game.equippedArtifactIds);
  const sequenceId = `${now}-${nextActionCount}`;
  return {
    game,
    outcome: {
      achievementRewardArtifactIds,
      artifactId: artifact?.id ?? null,
      artifactLevel: artifact ? artifactLevels[artifact.id]! : null,
      artifactWasDuplicate: wasDuplicate,
      dustEarned,
      newlyClaimedAchievementIds: newlyClaimed,
      rarity: artifact?.rarity ?? null,
      sequenceId,
      source,
      synergyIds: synergies.map((synergy) => synergy.id),
      worldElementId: worldElement?.id ?? null,
      xp,
    },
  };
}

export type LingvolernandoTrainingWordInput = {
  german: string;
  id: string;
  stage: number;
  translation: string;
};

function upsertJourneyWord(
  current: Readonly<LingvolernandoGameSnapshot>,
  source: LingvolernandoTrainingWordInput,
  remembered: boolean,
  now: number,
): LingvolernandoGameSnapshot['journey'] {
  const id = typeof source.id === 'string' ? source.id.trim().slice(0, 128) : '';
  if (!id) return { ...current.journey };
  const existing = current.journey.words.find((word) => word.id === id);
  const incomingStage = Number.isFinite(source.stage) ? clamp(Math.round(source.stage), 0, 8) : 0;
  // The local Journey copy is authoritative once a word has entered the
  // queue. Training responses may contain a stale SRS stage, so always grade
  // against the stored stage instead of allowing an old response to rewind it.
  const baseStage = existing?.stage ?? incomingStage;
  const nextStage = remembered ? Math.min(8, baseStage + 1) : Math.max(0, baseStage - 1);
  const german = typeof source.german === 'string' ? source.german.trim().slice(0, 256) : '';
  const translation = typeof source.translation === 'string' ? source.translation.trim().slice(0, 512) : '';
  if (!existing && (!remembered || nextStage < JOURNEY_MATURE_STAGE || !german || !translation)) return { ...current.journey };
  const nextGerman = german || existing?.german || '';
  const nextTranslation = translation || existing?.translation || '';
  if (!nextGerman || !nextTranslation) return { ...current.journey };
  const eligibleAt = existing?.eligibleAt ?? (nextStage >= JOURNEY_MATURE_STAGE ? now : now + LINGVOLERNANDO_JOURNEY_INTERVAL_MS);
  const word: LingvolernandoJourneyWord = {
    eligibleAt,
    german: nextGerman,
    id,
    lastJourneyAt: existing?.lastJourneyAt ?? null,
    remembered: existing?.remembered ?? 0,
    stage: nextStage,
    translation: nextTranslation,
  };
  const words = existing
    ? current.journey.words.map((item) => item.id === word.id ? word : item)
    : [...current.journey.words, word];
  // Existing words keep their current cycle position. Re-adding a word here
  // after it was already recalled would allow it to repeat before the rest of
  // the separate Journey queue has been exhausted.
  const remainingWordIds = [...new Set(existing
    ? current.journey.remainingWordIds
    : [...current.journey.remainingWordIds, word.id])];
  const earliestEligibleAt = words.reduce(
    (earliest, item) => Math.min(earliest, item.eligibleAt),
    Number.POSITIVE_INFINITY,
  );
  return {
    ...current.journey,
    nextAvailableAt: current.journey.nextAvailableAt ?? (Number.isFinite(earliestEligibleAt) ? earliestEligibleAt : null),
    remainingWordIds,
    words,
  };
}

function withAnswerCounter(
  current: Readonly<LingvolernandoGameSnapshot>,
  remembered: boolean,
  now: number,
): LingvolernandoGameSnapshot {
  return {
    ...current,
    learning: {
      ...current.learning,
      forgottenAnswers: current.learning.forgottenAnswers + (remembered ? 0 : 1),
      forgottenTowardAction: current.learning.forgottenTowardAction + (remembered ? 0 : 1),
      lastAnswerAt: now,
      rememberedAnswers: current.learning.rememberedAnswers + (remembered ? 1 : 0),
      rememberedTowardAction: current.learning.rememberedTowardAction + (remembered ? 1 : 0),
    },
    pet: {
      ...current.pet,
      mood: remembered ? 'focused' : 'curious',
    },
  };
}

export function recordLingvolernandoTrainingAnswer(
  current: Readonly<LingvolernandoGameSnapshot>,
  metrics: LingvolernandoProgressMetrics,
  source: LingvolernandoTrainingWordInput,
  answer: 'forgot' | 'remember',
  now = Date.now(),
): { game: LingvolernandoGameSnapshot; outcome: LingvolernandoRewardOutcome | null } {
  const remembered = answer === 'remember';
  const counted = withAnswerCounter(current, remembered, now);
  const prepared: LingvolernandoGameSnapshot = {
    ...counted,
    journey: upsertJourneyWord(counted, source, remembered, now),
  };
  const thresholdReached = remembered
    ? prepared.learning.rememberedTowardAction >= 10
    : prepared.learning.forgottenTowardAction >= 20;
  if (!thresholdReached) return { game: prepared, outcome: null };
  const ready: LingvolernandoGameSnapshot = {
    ...prepared,
    learning: {
      ...prepared.learning,
      forgottenTowardAction: remembered ? prepared.learning.forgottenTowardAction : prepared.learning.forgottenTowardAction % 20,
      rememberedTowardAction: remembered ? prepared.learning.rememberedTowardAction % 10 : prepared.learning.rememberedTowardAction,
    },
  };
  return completeLingvolernandoAction(ready, metrics, remembered ? 'remembered' : 'forgotten', now);
}

function journeyQueue(game: Readonly<LingvolernandoGameSnapshot>, now: number): LingvolernandoJourneyWord[] {
  const eligible = game.journey.words.filter((word) => word.eligibleAt <= now && word.stage >= JOURNEY_MATURE_STAGE);
  const eligibleById = new Map(eligible.map((word) => [word.id, word]));
  const usedIds = new Set<string>();
  const queued = game.journey.remainingWordIds
    .flatMap((id) => {
      const word = eligibleById.get(id);
      if (!word || usedIds.has(id)) return [];
      usedIds.add(id);
      return [word];
    });
  if (queued.length > 0) return queued;
  return [...eligible].sort((left, right) => (left.lastJourneyAt ?? 0) - (right.lastJourneyAt ?? 0) || left.id.localeCompare(right.id));
}

export function journeyWordForGame(
  game: Readonly<LingvolernandoGameSnapshot>,
  now = Date.now(),
): LingvolernandoJourneyWord | null {
  if (game.journey.nextAvailableAt !== null && game.journey.nextAvailableAt > now) return null;
  return journeyQueue(game, now)[0] ?? null;
}

export function journeyNextAvailableAt(game: Readonly<LingvolernandoGameSnapshot>, now = Date.now()): number | null {
  if (game.journey.nextAvailableAt !== null && game.journey.nextAvailableAt > now) return game.journey.nextAvailableAt;
  if (journeyQueue(game, now).length > 0) return now;
  let next = Number.POSITIVE_INFINITY;
  for (const word of game.journey.words) {
    if (word.stage >= JOURNEY_MATURE_STAGE && word.eligibleAt > now) next = Math.min(next, word.eligibleAt);
  }
  return Number.isFinite(next) ? next : null;
}

export function completeLingvolernandoJourneyRecall(
  current: Readonly<LingvolernandoGameSnapshot>,
  metrics: LingvolernandoProgressMetrics,
  remembered: boolean,
  now = Date.now(),
): { game: LingvolernandoGameSnapshot; outcome: LingvolernandoRewardOutcome | null } {
  const queue = journeyQueue(current, now);
  const word = (current.journey.nextAvailableAt === null || current.journey.nextAvailableAt <= now) ? queue[0] : null;
  if (!word) return { game: { ...current }, outcome: null };
  const remainingWordIds = queue.slice(1).map((item) => item.id);
  const position = current.journey.position + (remembered ? 1 : -1);
  const words = current.journey.words.map((item) => item.id === word.id ? {
    ...item,
    lastJourneyAt: now,
    remembered: item.remembered + (remembered ? 1 : 0),
  } : item);
  const journey = {
    ...current.journey,
    bestPosition: Math.max(current.journey.bestPosition, position),
    nextAvailableAt: now + LINGVOLERNANDO_JOURNEY_INTERVAL_MS,
    position,
    remainingWordIds,
    roundsCompleted: current.journey.roundsCompleted + (remainingWordIds.length === 0 ? 1 : 0),
    words,
  };
  const counted = withAnswerCounter({ ...current, journey }, remembered, now);
  const thresholdReached = remembered
    ? counted.learning.rememberedTowardAction >= 10
    : counted.learning.forgottenTowardAction >= 20;
  if (!thresholdReached) return { game: counted, outcome: null };
  const ready = {
    ...counted,
    learning: {
      ...counted.learning,
      forgottenTowardAction: remembered ? counted.learning.forgottenTowardAction : counted.learning.forgottenTowardAction % 20,
      rememberedTowardAction: remembered ? counted.learning.rememberedTowardAction % 10 : counted.learning.rememberedTowardAction,
    },
  };
  return completeLingvolernandoAction(ready, metrics, 'journey', now);
}

export function syncLingvolernandoCardCount(
  current: Readonly<LingvolernandoGameSnapshot>,
  activeCards: number,
): LingvolernandoGameSnapshot {
  const count = Number.isFinite(activeCards) ? Math.max(0, Math.round(activeCards)) : 0;
  if (!current.learning.cardCountInitialized) {
    return { ...current, learning: { ...current.learning, cardCountInitialized: true, knownCardCount: count } };
  }
  const knownCardCount = Number.isFinite(current.learning.knownCardCount)
    ? Math.max(0, Math.round(current.learning.knownCardCount))
    : 0;
  const added = Math.max(0, count - knownCardCount);
  if (added === 0) return {
    ...current,
    learning: { ...current.learning, knownCardCount: count },
  };
  const totalToward = current.learning.newWordsTowardBloom + added;
  const blooms = Math.floor(totalToward / NEW_WORD_BLOOM_TARGET);
  return {
    ...current,
    learning: {
      ...current.learning,
      addedWords: current.learning.addedWords + added,
      knownCardCount: count,
      newWordsTowardBloom: totalToward % NEW_WORD_BLOOM_TARGET,
      vocabularyBlooms: current.learning.vocabularyBlooms + blooms,
    },
    pet: { ...current.pet, mood: blooms > 0 ? 'glowing' : 'curious' },
    worldLight: current.worldLight + blooms * 8,
  };
}

export function renameLingvolernandoPet(
  current: Readonly<LingvolernandoGameSnapshot>,
  value: string,
): LingvolernandoGameSnapshot {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
  return name ? { ...current, pet: { ...current.pet, name } } : { ...current };
}

export function setLingvolernandoPetPalette(
  current: Readonly<LingvolernandoGameSnapshot>,
  palette: LingvolernandoPetPalette,
): LingvolernandoGameSnapshot {
  if (!VALID_PALETTES.has(palette)) return { ...current };
  return { ...current, pet: { ...current.pet, palette } };
}

export function toggleLingvolernandoPetArtifact(
  current: Readonly<LingvolernandoGameSnapshot>,
  artifactId: string,
): LingvolernandoGameSnapshot {
  if (!lingvolernandoArtifact(artifactId) || !current.discoveredArtifactIds.includes(artifactId)) return { ...current };
  const activeSlot = current.equippedArtifactIds.indexOf(artifactId);
  if (activeSlot >= 0) return equipLingvolernandoArtifact(current, artifactId, activeSlot);
  const emptySlot = current.equippedArtifactIds.findIndex((id) => id === null);
  return emptySlot >= 0 ? equipLingvolernandoArtifact(current, artifactId, emptySlot) : { ...current };
}

export function equipLingvolernandoArtifact(
  current: Readonly<LingvolernandoGameSnapshot>,
  artifactId: string,
  slot: number,
): LingvolernandoGameSnapshot {
  if (!lingvolernandoArtifact(artifactId) || !current.discoveredArtifactIds.includes(artifactId) || slot < 0 || slot >= 3) return { ...current };
  const equippedArtifactIds = [...current.equippedArtifactIds].slice(0, 3);
  while (equippedArtifactIds.length < 3) equippedArtifactIds.push(null);
  const isAlreadyInSlot = equippedArtifactIds[slot] === artifactId;
  for (let index = 0; index < equippedArtifactIds.length; index += 1) {
    if (equippedArtifactIds[index] === artifactId) equippedArtifactIds[index] = null;
  }
  if (!isAlreadyInSlot) equippedArtifactIds[slot] = artifactId;
  const accessoryArtifactIds = equippedArtifactIds.filter((id): id is string => Boolean(id));
  return { ...current, equippedArtifactIds, pet: { ...current.pet, accessoryArtifactIds } };
}

export function evolveLingvolernandoArtifact(
  current: Readonly<LingvolernandoGameSnapshot>,
  artifactId: string,
): LingvolernandoGameSnapshot {
  if (!lingvolernandoArtifact(artifactId) || !current.discoveredArtifactIds.includes(artifactId)) return { ...current };
  const currentLevel = clamp(
    Number.isFinite(current.artifactLevels[artifactId]) ? current.artifactLevels[artifactId]! : 1,
    1,
    99,
  );
  if (currentLevel >= 99) return { ...current };
  const cost = 12 + currentLevel * 8;
  const artifactDust = Number.isFinite(current.artifactDust) ? Math.max(0, current.artifactDust) : 0;
  if (artifactDust < cost) return { ...current };
  return {
    ...current,
    artifactDust: artifactDust - cost,
    artifactLevels: { ...current.artifactLevels, [artifactId]: currentLevel + 1 },
  };
}

export function setLingvolernandoBiome(
  current: Readonly<LingvolernandoGameSnapshot>,
  biomeIndex: number,
): LingvolernandoGameSnapshot {
  const index = Number.isFinite(biomeIndex)
    ? clamp(Math.round(biomeIndex), 0, LINGVOLERNANDO_BIOMES.length - 1)
    : current.selectedBiome;
  if (current.worldLight < LINGVOLERNANDO_BIOMES[index]!.unlockAt) return { ...current };
  return { ...current, selectedBiome: index };
}

function storageKey(ownerId: string, version = STORAGE_VERSION): string {
  return `kaordo.lingvolernando.game.v${version}.${encodeURIComponent(ownerId)}`;
}

function finiteNumber(value: unknown, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(Math.round(value), minimum, maximum)
    : fallback;
}

function validIds(value: unknown, valid: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && valid.has(id)))];
}

function timestampRecord(value: unknown, valid: ReadonlySet<string>): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, timestamp]) => (
    valid.has(id) && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
      ? [[id, Math.round(timestamp)]]
      : []
  )));
}

function sanitizeGame(value: unknown): LingvolernandoGameSnapshot {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_LINGVOLERNANDO_GAME);
  const source = value as Partial<LingvolernandoGameSnapshot> & {
    pet?: Partial<LingvolernandoGameSnapshot['pet']> & { accessoryArtifactId?: unknown };
  };
  const discoveredArtifactIds = validIds(source.discoveredArtifactIds, ARTIFACT_IDS);
  const artifactLevels = Object.fromEntries(Object.entries(source.artifactLevels ?? {}).flatMap(([id, level]) => (
    ARTIFACT_IDS.has(id) ? [[id, finiteNumber(level, 1, 1, 99)]] : []
  )));
  const pet = (source.pet && typeof source.pet === 'object'
    ? source.pet
    : EMPTY_LINGVOLERNANDO_GAME.pet) as Partial<LingvolernandoGameSnapshot['pet']> & {
      accessoryArtifactId?: unknown;
    };
  const equippedSource = Array.isArray(source.equippedArtifactIds) ? source.equippedArtifactIds.slice(0, 3) : [];
  const legacyAccessory = typeof pet.accessoryArtifactId === 'string' ? [pet.accessoryArtifactId] : [];
  const storedAccessoryArtifactIds = validIds(
    Array.isArray(pet.accessoryArtifactIds) ? pet.accessoryArtifactIds.slice(0, 3) : legacyAccessory,
    new Set(discoveredArtifactIds),
  ).slice(0, 3);
  // Companion selections from v3 were stored separately from the active loadout.
  // Prefer the loadout when it exists; otherwise promote the old carried list so
  // both screens continue to describe and mutate the same three slots.
  const storedLoadoutIds = equippedSource.filter((id): id is string => typeof id === 'string' && discoveredArtifactIds.includes(id));
  const loadoutSource = storedLoadoutIds.length > 0 ? storedLoadoutIds : storedAccessoryArtifactIds;
  const equippedArtifactIds = Array.from({ length: 3 }, (_, index) => {
    const id = loadoutSource[index];
    return typeof id === 'string' && discoveredArtifactIds.includes(id) && loadoutSource.indexOf(id) === index ? id : null;
  });
  const accessoryArtifactIds = equippedArtifactIds.filter((id): id is string => Boolean(id));
  const hasStoredCardCount = Boolean(source.learning && typeof source.learning === 'object' && 'knownCardCount' in source.learning);
  const learningSource = source.learning && typeof source.learning === 'object' ? source.learning : EMPTY_LINGVOLERNANDO_GAME.learning;
  const journeySource = source.journey && typeof source.journey === 'object' ? source.journey : EMPTY_LINGVOLERNANDO_GAME.journey;
  const sanitizeNow = Date.now();
  const seenWordIds = new Set<string>();
  const words = Array.isArray(journeySource.words) ? journeySource.words.flatMap((candidate): LingvolernandoJourneyWord[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const word = candidate as Partial<LingvolernandoJourneyWord>;
    const id = typeof word.id === 'string' ? word.id.trim().slice(0, 128) : '';
    const german = typeof word.german === 'string' ? word.german.trim().slice(0, 256) : '';
    const translation = typeof word.translation === 'string' ? word.translation.trim().slice(0, 512) : '';
    if (!id || seenWordIds.has(id) || !german || !translation) return [];
    seenWordIds.add(id);
    return [{
      eligibleAt: finiteNumber(word.eligibleAt, sanitizeNow),
      german,
      id,
      lastJourneyAt: typeof word.lastJourneyAt === 'number' && Number.isFinite(word.lastJourneyAt) ? Math.round(word.lastJourneyAt) : null,
      remembered: finiteNumber(word.remembered, 0),
      stage: finiteNumber(word.stage, JOURNEY_MATURE_STAGE, 0, 8),
      translation,
    }];
  }).slice(0, 2_000) : [];
  const journeyWordIds = new Set(words.map((word) => word.id));
  const remainingWordIds = Array.isArray(journeySource.remainingWordIds)
    ? [...new Set(journeySource.remainingWordIds.filter((id): id is string => typeof id === 'string' && journeyWordIds.has(id)))]
    : words.map((word) => word.id);
  return {
    actionCount: finiteNumber(source.actionCount, 0),
    artifactDiscoveredAt: timestampRecord(source.artifactDiscoveredAt, ARTIFACT_IDS),
    artifactDust: finiteNumber(source.artifactDust, 0),
    artifactLevels,
    achievementClaimedAt: timestampRecord(source.achievementClaimedAt, ACHIEVEMENT_IDS),
    claimedAchievementIds: validIds(source.claimedAchievementIds, ACHIEVEMENT_IDS),
    discoveredArtifactIds,
    discoveredWorldIds: validIds(source.discoveredWorldIds, WORLD_IDS),
    earnedXp: finiteNumber(source.earnedXp, 0),
    equippedArtifactIds,
    journey: {
      bestPosition: finiteNumber(journeySource.bestPosition, 0, -100_000, 100_000),
      nextAvailableAt: typeof journeySource.nextAvailableAt === 'number' && Number.isFinite(journeySource.nextAvailableAt) ? Math.round(journeySource.nextAvailableAt) : null,
      position: finiteNumber(journeySource.position, 0, -100_000, 100_000),
      remainingWordIds,
      roundsCompleted: finiteNumber(journeySource.roundsCompleted, 0),
      words,
    },
    lastActionAt: typeof source.lastActionAt === 'number' && Number.isFinite(source.lastActionAt) ? source.lastActionAt : null,
    learning: {
      addedWords: finiteNumber(learningSource.addedWords, 0),
      cardCountInitialized: typeof learningSource.cardCountInitialized === 'boolean'
        ? learningSource.cardCountInitialized
        : hasStoredCardCount,
      forgottenAnswers: finiteNumber(learningSource.forgottenAnswers, 0),
      forgottenTowardAction: finiteNumber(learningSource.forgottenTowardAction, 0, 0, 19),
      knownCardCount: finiteNumber(learningSource.knownCardCount, 0),
      lastAnswerAt: typeof learningSource.lastAnswerAt === 'number' && Number.isFinite(learningSource.lastAnswerAt) ? Math.round(learningSource.lastAnswerAt) : null,
      newWordsTowardBloom: finiteNumber(learningSource.newWordsTowardBloom, 0, 0, NEW_WORD_BLOOM_TARGET - 1),
      rememberedAnswers: finiteNumber(learningSource.rememberedAnswers, 0),
      rememberedTowardAction: finiteNumber(learningSource.rememberedTowardAction, 0, 0, 9),
      vocabularyBlooms: finiteNumber(learningSource.vocabularyBlooms, 0),
    },
    pet: {
      accessoryArtifactIds,
      mood: typeof pet.mood === 'string' && VALID_MOODS.has(pet.mood as LingvolernandoGameSnapshot['pet']['mood']) ? pet.mood as LingvolernandoGameSnapshot['pet']['mood'] : 'curious',
      name: typeof pet.name === 'string' && pet.name.trim() ? pet.name.trim().slice(0, 24) : 'Luma',
      palette: typeof pet.palette === 'string' && VALID_PALETTES.has(pet.palette as LingvolernandoPetPalette) ? pet.palette as LingvolernandoPetPalette : 'moon',
    },
    pity: finiteNumber(source.pity, 0, 0, 20),
    selectedBiome: finiteNumber(source.selectedBiome, 0, 0, LINGVOLERNANDO_BIOMES.length - 1),
    version: STORAGE_VERSION,
    worldLight: finiteNumber(source.worldLight, 0),
  };
}

function migrateLegacyGame(): LingvolernandoGameSnapshot {
  const game = structuredClone(EMPTY_LINGVOLERNANDO_GAME);
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PROGRESS_KEY) ?? 'null') as {
      discoveredRewardIds?: unknown;
      earnedXp?: unknown;
      lastReward?: unknown;
    } | null;
    const relics = legacy?.discoveredRewardIds ?? JSON.parse(localStorage.getItem(LEGACY_RELICS_KEY) ?? '[]');
    game.discoveredArtifactIds = validIds(relics, ARTIFACT_IDS);
    game.artifactLevels = Object.fromEntries(game.discoveredArtifactIds.map((id) => [id, 1]));
    game.earnedXp = finiteNumber(legacy?.earnedXp, 0);
  } catch {
    return game;
  }
  return game;
}

export function readLingvolernandoGame(ownerId: string): LingvolernandoGameSnapshot {
  if (typeof localStorage === 'undefined') return structuredClone(EMPTY_LINGVOLERNANDO_GAME);
  try {
    const stored = localStorage.getItem(storageKey(ownerId)) ?? localStorage.getItem(storageKey(ownerId, 2));
    return stored ? sanitizeGame(JSON.parse(stored)) : migrateLegacyGame();
  } catch {
    return structuredClone(EMPTY_LINGVOLERNANDO_GAME);
  }
}

export function writeLingvolernandoGame(ownerId: string, game: Readonly<LingvolernandoGameSnapshot>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify(game));
  } catch {
    // The game is an enhancement. Storage failures must not block Ilo.
  }
}
