import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { IloBootstrap, IloCardInput, IloCardPage, IloMutation, IloProgress, IloTrainSnapshot } from '../domain/ilo';
import type { IloCardsQuery, IloGateway } from './IloGateway';
import type { TauriInvoke } from './TauriWorkspaceGateway';

export class TauriIloGateway implements IloGateway {
  constructor(private readonly invoke: TauriInvoke = tauriInvoke) {}
  bootstrap(): Promise<IloBootstrap> { return this.invoke('ilo_bootstrap'); }
  createCard(input: IloCardInput): Promise<IloMutation> { return this.invoke('ilo_create_card', { input }); }
  deleteCard(cardId: string): Promise<IloMutation> { return this.invoke('ilo_delete_card', { cardId }); }
  deleteCards(cardIds: string[]): Promise<IloMutation> { return this.invoke('ilo_delete_cards', { cardIds }); }
  grade(cardId: string, action: 'forgot' | 'remember'): Promise<IloMutation> {
    return this.invoke('ilo_grade', { action, cardId });
  }
  listCards(query: IloCardsQuery = {}): Promise<IloCardPage> {
    return this.invoke('ilo_cards', {
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      q: query.q ?? '',
      theme: query.theme ?? '',
    });
  }
  nextTrain(): Promise<IloTrainSnapshot> { return this.invoke('ilo_train_next'); }
  progress(): Promise<IloProgress> { return this.invoke('ilo_progress'); }
  updateCard(cardId: string, input: IloCardInput): Promise<IloMutation> {
    return this.invoke('ilo_update_card', { cardId, input });
  }
}
