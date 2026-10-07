// Provides German card presentation, phrase exercises and cancellable browser pronunciation
import type { LingvoCardContent } from '@kaordo/contracts';

export const nativeLanguages = [{ code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'en', name: 'English', nativeName: 'English' }] as const;
export const ratings = [
  { value: 1, label: 'Again', hint: 'I forgot' }, { value: 2, label: 'Hard', hint: 'With effort' },
  { value: 3, label: 'Good', hint: 'I remembered' }, { value: 4, label: 'Easy', hint: 'Without effort' }
] as const;
export function germanTerm(card: Pick<LingvoCardContent, 'article' | 'term'>): string {
  return [card.article, card.term].filter(Boolean).join(' ');
}

export function emptyCard(kind: 'word' | 'phrase' = 'word', folderId: string | null = null): LingvoCardContent {
  return { kind, folderId, term: '', translation: '', partOfSpeech: '', article: '', plural: '',
    grammar: '', example: '', exampleTranslation: '', notes: '', status: 'active' };
}

export function cardContent(card: LingvoCardContent): LingvoCardContent {
  const { kind, term, translation, partOfSpeech, article, plural, grammar, example,
    exampleTranslation, notes, folderId, status } = card;
  return { kind, term, translation, partOfSpeech, article, plural, grammar, example, exampleTranslation, notes, folderId, status };
}

export function normalizeAnswer(text: string): string {
  return text.normalize('NFC').trim().toLocaleLowerCase('de').replace(/[.,!?;:„“"']/g, '').replace(/\s+/g, ' ');
}

export function phraseTokens(phrase: string, seed: string): { id: number; text: string }[] {
  const words = phrase.trim().split(/\s+/).map((text, id) => ({ id, text }));
  // Stable shuffle keeps duplicate words distinct and avoids moving tiles on rerenders
  let hash = Array.from(seed).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
  for (let index = words.length - 1; index > 0; index--) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    const target = hash % (index + 1);
    [words[index], words[target]] = [words[target], words[index]];
  }
  return words;
}

export class Pronunciation {
  private utterance: SpeechSynthesisUtterance | null = null;
  private disposed = false;

  speak(text: string): boolean {
    if (this.disposed || typeof speechSynthesis === 'undefined') return false;
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 0.85;
    utterance.voice = speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith('de')) ?? null;
    this.utterance = utterance;
    utterance.onend = utterance.onerror = () => { if (this.utterance === utterance) this.utterance = null; };
    speechSynthesis.speak(utterance);
    return true;
  }

  stop(): void {
    if (this.utterance && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.utterance = null;
  }

  dispose(): void { this.stop(); this.disposed = true; }
}
