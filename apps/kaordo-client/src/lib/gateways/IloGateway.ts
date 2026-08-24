import type {
  IloBootstrap,
  IloCardInput,
  IloCardPage,
  IloMutation,
  IloProgress,
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
}
