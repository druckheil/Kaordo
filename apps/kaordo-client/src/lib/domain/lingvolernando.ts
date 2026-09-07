export type LingvolernandoArtifactRarity = 'common' | 'rare' | 'epic' | 'mythic';
export type LingvolernandoArtifactTrait =
  | 'context'
  | 'curiosity'
  | 'focus'
  | 'memory'
  | 'momentum'
  | 'precision';
export type LingvolernandoArtifactModifier =
  | 'aurora'
  | 'crystal'
  | 'echo'
  | 'garden'
  | 'lunar'
  | 'prism'
  | 'solar'
  | 'void';

export type LingvolernandoArtifactDefinition = {
  accent: string;
  animationIndex: number;
  description: string;
  form: number;
  id: string;
  material: string;
  modifier: LingvolernandoArtifactModifier;
  name: string;
  rarity: LingvolernandoArtifactRarity;
  secondaryTrait: LingvolernandoArtifactTrait;
  secondaryValue: number;
  trait: LingvolernandoArtifactTrait;
  unlockAt: number;
  value: number;
};

export type LingvolernandoWorldKind = 'creature' | 'flora' | 'landmark' | 'phenomenon' | 'workshop';

export type LingvolernandoWorldElementDefinition = {
  accent: string;
  biome: string;
  description: string;
  effect: string;
  id: string;
  kind: LingvolernandoWorldKind;
  name: string;
  sprite: number;
  unlockAt: number;
  x: number;
  y: number;
};

export type LingvolernandoAchievementMetric =
  | 'actions'
  | 'artifacts'
  | 'cards'
  | 'days'
  | 'remembered'
  | 'world';

export type LingvolernandoAchievementDefinition = {
  accent: string;
  description: string;
  id: string;
  metric: LingvolernandoAchievementMetric;
  name: string;
  path: string;
  rewardArtifactId: string;
  target: number;
  tier: number;
};

export type LingvolernandoSynergyDefinition = {
  accent: string;
  description: string;
  id: string;
  name: string;
  requiredTraits: Partial<Record<LingvolernandoArtifactTrait, number>>;
};

export type LingvolernandoPetMood = 'curious' | 'dreaming' | 'focused' | 'glowing' | 'resting';
export type LingvolernandoPetPalette = 'aurora' | 'ember' | 'moon' | 'moss';

export type LingvolernandoPetState = {
  accessoryArtifactIds: string[];
  mood: LingvolernandoPetMood;
  name: string;
  palette: LingvolernandoPetPalette;
};

export type LingvolernandoJourneyWord = {
  eligibleAt: number;
  german: string;
  id: string;
  lastJourneyAt: number | null;
  remembered: number;
  stage: number;
  translation: string;
};

export type LingvolernandoJourneyState = {
  bestPosition: number;
  nextAvailableAt: number | null;
  position: number;
  remainingWordIds: string[];
  roundsCompleted: number;
  words: LingvolernandoJourneyWord[];
};

export type LingvolernandoLearningState = {
  addedWords: number;
  cardCountInitialized: boolean;
  forgottenAnswers: number;
  forgottenTowardAction: number;
  knownCardCount: number;
  lastAnswerAt: number | null;
  newWordsTowardBloom: number;
  rememberedAnswers: number;
  rememberedTowardAction: number;
  vocabularyBlooms: number;
};

export type LingvolernandoGameBonuses = {
  artifactChancePercent: number;
  dustPercent: number;
  worldLightPercent: number;
  xpPercent: number;
};

export type LingvolernandoGameSnapshot = {
  actionCount: number;
  artifactDiscoveredAt: Record<string, number>;
  artifactDust: number;
  artifactLevels: Record<string, number>;
  achievementClaimedAt: Record<string, number>;
  claimedAchievementIds: string[];
  discoveredArtifactIds: string[];
  discoveredWorldIds: string[];
  earnedXp: number;
  equippedArtifactIds: Array<string | null>;
  journey: LingvolernandoJourneyState;
  lastActionAt: number | null;
  learning: LingvolernandoLearningState;
  pet: LingvolernandoPetState;
  pity: number;
  selectedBiome: number;
  version: 3;
  worldLight: number;
};

export type LingvolernandoRewardOutcome = {
  achievementRewardArtifactIds: string[];
  artifactId: string | null;
  artifactLevel: number | null;
  artifactWasDuplicate: boolean;
  dustEarned: number;
  newlyClaimedAchievementIds: string[];
  rarity: LingvolernandoArtifactRarity | null;
  sequenceId: string;
  source: 'forgotten' | 'journey' | 'remembered';
  synergyIds: string[];
  worldElementId: string | null;
  xp: number;
};

export const EMPTY_LINGVOLERNANDO_GAME: LingvolernandoGameSnapshot = {
  actionCount: 0,
  artifactDiscoveredAt: {},
  artifactDust: 0,
  artifactLevels: {},
  achievementClaimedAt: {},
  claimedAchievementIds: [],
  discoveredArtifactIds: [],
  discoveredWorldIds: [],
  earnedXp: 0,
  equippedArtifactIds: [null, null, null],
  journey: {
    bestPosition: 0,
    nextAvailableAt: null,
    position: 0,
    remainingWordIds: [],
    roundsCompleted: 0,
    words: [],
  },
  lastActionAt: null,
  learning: {
    addedWords: 0,
    cardCountInitialized: false,
    forgottenAnswers: 0,
    forgottenTowardAction: 0,
    knownCardCount: 0,
    lastAnswerAt: null,
    newWordsTowardBloom: 0,
    rememberedAnswers: 0,
    rememberedTowardAction: 0,
    vocabularyBlooms: 0,
  },
  pet: {
    accessoryArtifactIds: [],
    mood: 'curious',
    name: 'Luma',
    palette: 'moon',
  },
  pity: 0,
  selectedBiome: 0,
  version: 3,
  worldLight: 0,
};
