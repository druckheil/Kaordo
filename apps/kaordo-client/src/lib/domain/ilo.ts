export const ILO_THEMES = [
  'food', 'work', 'action', 'home', 'nature', 'travel', 'health', 'people',
  'study', 'adjectives', 'appearance', 'animals', 'body', 'clothes', 'emotions',
  'shopping', 'technology', 'transport', 'weather', 'other',
] as const;

export type IloTheme = typeof ILO_THEMES[number];
export type IloTab = 'add' | 'edit' | 'progress' | 'search' | 'train';
export type IloTask = 'cloze_example' | 'de_to_native' | 'native_to_de';

export type IloCard = {
  article: string;
  createdAt: number;
  example: string;
  failureCount: number;
  german: string;
  id: string;
  nextReviewAt: number;
  note: string;
  plural: string;
  stage: number;
  theme: string;
  translation: string;
  updatedAt: number;
};

export type IloCardInput = Pick<IloCard, 'article' | 'example' | 'german' | 'note' | 'plural' | 'theme' | 'translation'>;

export type IloTrainingCard = {
  answerLines: string[];
  id: string;
  promptText: string;
  promptTitle: string;
  stage: number;
  task: IloTask;
};

export type IloTrainSnapshot = {
  active: number;
  card: IloTrainingCard | null;
  due: number;
};

export type IloProgress = {
  active: number;
  due: number;
  learnedToday: boolean;
  pointsHistory: Array<{ date: string; points: number }>;
  stages: Record<string, number>;
  todayPoints: number;
};

export type IloSettings = { nativeLabel: string; onboarded: boolean };

export type IloBootstrap = {
  progress: IloProgress;
  settings: IloSettings;
  themes: string[];
  train: IloTrainSnapshot;
};

export type IloCardPage = { cards: IloCard[]; nextOffset: number | null };
export type IloMutation = { card: IloCard | null; progress: IloProgress; train: IloTrainSnapshot };

export type IloErrorEntry = { at: number; message: string; operation: string };

export type IloSnapshot = {
  cards: IloCard[];
  cardsHasMore: boolean;
  cardsLoaded: boolean;
  cardsLoading: boolean;
  error: string | null;
  logs: IloErrorEntry[];
  phase: 'idle' | 'loading' | 'ready';
  refreshing: boolean;
  progress: IloProgress;
  settings: IloSettings;
  themes: string[];
  train: IloTrainSnapshot;
  busy: string | null;
};

export const EMPTY_ILO_PROGRESS: IloProgress = {
  active: 0,
  due: 0,
  learnedToday: false,
  pointsHistory: [],
  stages: {},
  todayPoints: 0,
};
