import type {
  IloBootstrap,
  IloCardInput,
  IloCardPage,
  IloMutation,
  IloProgress,
  TaglibroBootstrap,
  TaglibroDay,
  TaglibroEvent,
  TaglibroEventInput,
  TaglibroPlan,
  IloTrainSnapshot,
} from '../domain/ilo';

export type IloCardsQuery = { limit?: number; offset?: number; q?: string; theme?: string };

export interface IloGateway {
  bootstrap(): Promise<IloBootstrap>;
  createCard(input: IloCardInput): Promise<IloMutation>;
  deleteCard(cardId: string): Promise<IloMutation>;
  deleteCards(cardIds: string[]): Promise<IloMutation>;
  grade(cardId: string, action: 'forgot' | 'remember'): Promise<IloMutation>;
  listCards(query?: IloCardsQuery): Promise<IloCardPage>;
  nextTrain(): Promise<IloTrainSnapshot>;
  progress(): Promise<IloProgress>;
  updateCard(cardId: string, input: IloCardInput): Promise<IloMutation>;
  taglibroBootstrap(): Promise<TaglibroBootstrap>;
  taglibroDay(date: string): Promise<TaglibroDay>;
  taglibroSavePlans(date: string, plans: TaglibroPlan[]): Promise<TaglibroDay>;
  taglibroSaveDiary(
    date: string,
    diary: TaglibroDay['diary'],
  ): Promise<TaglibroDay>;
  taglibroSaveDay(date: string, day: Pick<TaglibroDay, 'plans' | 'diary'>): Promise<TaglibroDay>;
  taglibroListEvents(includePast?: boolean): Promise<{ events: TaglibroEvent[] }>;
  taglibroCreateEvent(input: TaglibroEventInput): Promise<TaglibroEvent>;
  taglibroUpdateEvent(eventId: string, input: TaglibroEventInput): Promise<TaglibroEvent>;
  taglibroDeleteEvent(eventId: string): Promise<void>;
}
