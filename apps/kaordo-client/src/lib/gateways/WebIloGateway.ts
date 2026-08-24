import type {
  IloBootstrap, IloCardInput, IloCardPage, IloMutation, IloProgress, IloTrainSnapshot,
  TaglibroBootstrap, TaglibroDay, TaglibroEvent, TaglibroEventInput, TaglibroPlan,
} from '../domain/ilo';
import type { IloCardsQuery, IloGateway } from './IloGateway';
import { requestJson } from './WebApiClient';

const UNAVAILABLE = 'Lingvolernado is unavailable.';
const TAGLIBRO_UNAVAILABLE = 'Taglibroplanilo is unavailable.';

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
  taglibroBootstrap(): Promise<TaglibroBootstrap> {
    return requestJson('/api/ilo/taglibro/bootstrap', {}, TAGLIBRO_UNAVAILABLE);
  }
  taglibroDay(date: string): Promise<TaglibroDay> {
    return requestJson(`/api/ilo/taglibro/day?date=${encodeURIComponent(date)}`, {}, TAGLIBRO_UNAVAILABLE);
  }
  taglibroSavePlans(date: string, plans: TaglibroPlan[]): Promise<TaglibroDay> {
    return requestJson('/api/ilo/taglibro/plans', jsonRequest('PUT', { date, plans }), TAGLIBRO_UNAVAILABLE);
  }
  taglibroSaveDiary(date: string, diary: TaglibroDay['diary']): Promise<TaglibroDay> {
    return requestJson('/api/ilo/taglibro/diary', jsonRequest('PUT', { date, diary }), TAGLIBRO_UNAVAILABLE);
  }
  taglibroSaveDay(date: string, day: Pick<TaglibroDay, 'plans' | 'diary'>): Promise<TaglibroDay> {
    return requestJson('/api/ilo/taglibro/day', jsonRequest('PUT', { date, ...day }), TAGLIBRO_UNAVAILABLE);
  }
  taglibroListEvents(includePast = false): Promise<{ events: TaglibroEvent[] }> {
    return requestJson(`/api/ilo/taglibro/events?includePast=${includePast ? '1' : '0'}`, {}, TAGLIBRO_UNAVAILABLE);
  }
  taglibroCreateEvent(input: TaglibroEventInput): Promise<TaglibroEvent> {
    return requestJson('/api/ilo/taglibro/events', jsonRequest('POST', input), TAGLIBRO_UNAVAILABLE);
  }
  taglibroUpdateEvent(eventId: string, input: TaglibroEventInput): Promise<TaglibroEvent> {
    return requestJson(`/api/ilo/taglibro/events/${encodeURIComponent(eventId)}`, jsonRequest('PATCH', input), TAGLIBRO_UNAVAILABLE);
  }
  async taglibroDeleteEvent(eventId: string): Promise<void> {
    await requestJson(`/api/ilo/taglibro/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, TAGLIBRO_UNAVAILABLE);
  }
}

function jsonRequest(method: string, value: unknown): RequestInit {
  return { body: JSON.stringify(value), headers: { 'content-type': 'application/json' }, method };
}
