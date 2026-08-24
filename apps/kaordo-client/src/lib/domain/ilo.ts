export const ILO_THEMES = [
  'food', 'work', 'action', 'home', 'nature', 'travel', 'health', 'people',
  'study', 'adjectives', 'appearance', 'animals', 'body', 'clothes', 'emotions',
  'shopping', 'technology', 'transport', 'weather', 'other',
] as const;

export type IloTheme = typeof ILO_THEMES[number];
export type IloTab = 'add' | 'edit' | 'progress' | 'search' | 'train';
export type IloTask = 'cloze_example' | 'de_to_native' | 'native_to_de';
export type TaglibroTab = 'plans' | 'diary' | 'calendar' | 'events';

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

export type TaglibroPlan = {
  accent: boolean;
  createdDate: string;
  id: string;
  text: string;
};

export type TaglibroPlanState = {
  checked: boolean;
  status: 'pending' | 'done' | 'skipped';
};

export type TaglibroDiary = {
  mood: string;
  planState: Record<string, TaglibroPlanState>;
  text: string;
};

export type TaglibroDay = {
  date: string;
  diary: TaglibroDiary;
  plans: TaglibroPlan[];
};

export type TaglibroEvent = {
  createdAt: number;
  description: string;
  eventAt: number;
  eventIso: string;
  id: string;
  notifyAtEventTime: boolean;
  remindOffsetMin: number | null;
  reminderEnabled: boolean;
  remainingSeconds: number;
  title: string;
  updatedAt: number;
};

export type TaglibroBootstrap = {
  events: TaglibroEvent[];
  today: TaglibroDay;
  timezone: string;
};

export type TaglibroEventInput = {
  description: string;
  eventAt: string;
  notifyAtEventTime: boolean;
  remindOffsetMin: number | null;
  reminderEnabled: boolean;
  title: string;
};

export type TaglibroSnapshot = {
  bootstrap: TaglibroBootstrap | null;
  busy: string | null;
  calendar: TaglibroDay | null;
  error: string | null;
  events: TaglibroEvent[];
  eventsLoaded: boolean;
  eventsLoading: boolean;
  eventsIncludePast: boolean;
  phase: 'idle' | 'loading' | 'ready';
  refreshing: boolean;
  selectedDate: string;
};

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
  taglibro: TaglibroSnapshot;
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

export const EMPTY_TAGLIBRO_DAY = (date = ''): TaglibroDay => ({
  date,
  diary: { mood: '🙂', planState: {}, text: '' },
  plans: [],
});

export const EMPTY_TAGLIBRO_SNAPSHOT: TaglibroSnapshot = {
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
};
