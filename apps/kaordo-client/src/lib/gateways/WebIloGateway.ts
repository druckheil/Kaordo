import type { IloBootstrap, IloCardInput, IloCardPage, IloMutation, IloProgress, IloTrainSnapshot } from '../domain/ilo';
import type { IloCardsQuery, IloGateway } from './IloGateway';
import { requestJson } from './WebApiClient';

const UNAVAILABLE = 'Lingvolernado is unavailable.';

export class WebIloGateway implements IloGateway {
  bootstrap(): Promise<IloBootstrap> {
    return requestJson('/api/ilo/bootstrap', {}, UNAVAILABLE);
  }
  createCard(input: IloCardInput): Promise<IloMutation> {
    return requestJson('/api/ilo/cards', jsonRequest('POST', input), UNAVAILABLE);
  }
  deleteCard(cardId: string): Promise<IloMutation> {
    return requestJson(`/api/ilo/cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' }, UNAVAILABLE);
  }
  deleteCards(cardIds: string[]): Promise<IloMutation> {
    return requestJson('/api/ilo/cards', jsonRequest('DELETE', { cardIds }), UNAVAILABLE);
  }
  grade(cardId: string, action: 'forgot' | 'remember'): Promise<IloMutation> {
    return requestJson('/api/ilo/train/grade', jsonRequest('POST', { action, cardId }), UNAVAILABLE);
  }
  listCards(query: IloCardsQuery = {}): Promise<IloCardPage> {
    const params = new URLSearchParams({
      limit: String(query.limit ?? 50),
      offset: String(query.offset ?? 0),
    });
    if (query.q?.trim()) params.set('q', query.q.trim());
    if (query.theme?.trim()) params.set('theme', query.theme.trim());
    return requestJson(`/api/ilo/cards?${params}`, {}, UNAVAILABLE);
  }
  nextTrain(): Promise<IloTrainSnapshot> {
    return requestJson('/api/ilo/train/next', {}, UNAVAILABLE);
  }
  progress(): Promise<IloProgress> {
    return requestJson('/api/ilo/progress', {}, UNAVAILABLE);
  }
  updateCard(cardId: string, input: IloCardInput): Promise<IloMutation> {
    return requestJson(`/api/ilo/cards/${encodeURIComponent(cardId)}`, jsonRequest('PATCH', input), UNAVAILABLE);
  }
}

function jsonRequest(method: string, value: unknown): RequestInit {
  return { body: JSON.stringify(value), headers: { 'content-type': 'application/json' }, method };
}
