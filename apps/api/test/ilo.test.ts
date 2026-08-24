import { describe, expect, it } from 'vitest';
import { buildClozePrompt, buildTrainingCard, selectTask } from '../src/ilo/training';

const baseCard = {
  article: '',
  example: '',
  german: 'lernen',
  id: 'abc12345',
  plural: '',
  stage: 0,
  theme: 'study',
  translation: 'учить',
};

describe('Lingvolernado training rules', () => {
  it('builds an exact-expression cloze without losing surrounding text', () => {
    expect(buildClozePrompt({
      example: 'Wir lernen heute Deutsch.',
      german: 'lernen',
      translation: 'учить',
    })?.masked).toBe('Wir ____ heute Deutsch.');
  });

  it('masks both pieces of a separable German verb', () => {
    expect(buildClozePrompt({
      example: 'Ich stehe jeden Tag früh auf.',
      german: 'aufstehen',
      translation: 'вставать',
    })?.masked).toBe('Ich ____ jeden Tag früh ____.');
  });

  it('falls back from cloze when a card has no usable example', () => {
    expect(selectTask({ ...baseCard, stage: 2 })).toBe('de_to_native');
  });

  it('uses the account language label in German-to-native prompts', () => {
    expect(buildTrainingCard(baseCard, 'russian')).toMatchObject({
      promptText: 'lernen',
      promptTitle: 'Translate to Russian',
      task: 'de_to_native',
    });
  });
});
