// Verifies shared Lingvo input, language presentation and deterministic scheduler previews
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cardContent, emptyCard, germanTerm, normalizeAnswer, phraseTokens, Pronunciation } from '../packages/lingvo-client/src/index.ts';
import { parseCardInput } from '../packages/lingvo-client/src/card-input.ts';
import { cardPrompt, parseAIInput, aiInputLimit } from '../packages/lingvo-client/src/ai-input.ts';
import { importCSV, downloadCSV } from '../packages/lingvo-client/src/csv.ts';
import { reviewPreviews, reviewIntervals } from '../packages/lingvo-client/src/scheduler.ts';

const folder = { id: '01999abc-1234-7000-8000-000000000001', dictionaryId: 'dictionary', name: 'Everyday' };
const word = { ...emptyCard(), term: 'Haus', translation: 'house', partOfSpeech: 'noun', article: 'das' };

test('German presentation preserves articles and Unicode answer distinctions', () => {
  assert.equal(germanTerm(word), 'das Haus');
  assert.equal(germanTerm({ ...word, article: '' }), 'Haus');
  assert.equal(normalizeAnswer('  „HA\u0308USER“,  sind  schön! '), 'häuser sind schön');
  assert.notEqual(normalizeAnswer('schon'), normalizeAnswer('schön'));
  const content = cardContent({ ...word, id: 'private-id', schedule: { reps: 4 }, revision: 9 });
  assert.deepEqual(content, word);
  assert.equal('id' in content, false);
});

test('phrase exercises shuffle deterministically without losing duplicate tokens', () => {
  const source = 'Ich weiß dass ich es weiß';
  const tiles = phraseTokens(source, 'card-1');
  assert.deepEqual(tiles, phraseTokens(source, 'card-1'));
  assert.deepEqual(tiles.toSorted((a, b) => a.id - b.id).map(tile => tile.text), source.split(' '));
  assert.equal(new Set(tiles.map(tile => tile.id)).size, 6);
});

test('shared card parsing normalizes NFC and infers noun type from an article', () => {
  assert.deepEqual(parseCardInput({ term: ' Ha\u0308user ', translation: ' houses ', article: 'die' }, folder.id),
    { ...emptyCard('word', folder.id), term: 'Häuser', translation: 'houses', article: 'die', partOfSpeech: 'noun' });
  assert.equal(parseCardInput({ term: 'Ich lerne.', translation: 'I study.', kind: 'phrase', status: 'known' }, null).status, 'known');
});

test('shared parsing rejects invalid enums, article combinations, oversized and control text', () => {
  for (const patch of [{ kind: 'wrong' }, { status: 'wrong' }, { partOfSpeech: 'wrong' }, { article: 'den' },
    { article: 'das', kind: 'phrase' }, { article: 'das', partOfSpeech: 'verb' }, { term: '' },
    { term: 'ü'.repeat(301) }, { notes: 'bad\u0000text' }, { example: 'bad\u0085text' }]) {
    assert.throws(() => parseCardInput({ term: 'Haus', translation: 'house', ...patch }, null));
  }
  assert.equal(parseCardInput({ term: 'ü'.repeat(300), translation: 'house', notes: 'line\n\tline' }, null).term.length, 300);
});

test('AI prompt describes the selected pair, current card and exact existing folders', () => {
  const prompt = cardPrompt({ ...word, folderId: folder.id }, 'ru', [folder]);
  assert.match(prompt, /Native language: Russian/);
  assert.match(prompt, /kind\|\|german\|\|translation\|\|folder/);
  assert.ok(prompt.includes('German word or phrase: "Haus"'));
  assert.ok(prompt.includes('Existing folder names (use an exact name or leave empty): ["Everyday"]'));
  assert.match(cardPrompt(emptyCard('phrase'), 'en', []), /Card type: phrase/);
});

const aiRecord = 'word||Haus||house||Everyday||noun||das||die Häuser||||"Das || Haus ist schön.\nEs ist groß."||The house is beautiful.||||active';

test('AI input uses real CSV quoting and applies one complete record without saving it', () => {
  const parsed = parseAIInput(aiRecord, [folder]);
  assert.equal(parsed.term, 'Haus');
  assert.equal(parsed.folderId, folder.id);
  assert.equal(parsed.example, 'Das || Haus ist schön.\nEs ist groß.');
  assert.equal(parsed.status, 'active');
  const header = 'kind||german||translation||folder||partOfSpeech||article||plural||grammar||example||exampleTranslation||notes||status';
  assert.deepEqual(parseAIInput(header + '\n' + aiRecord, [folder]), parsed);
  assert.deepEqual(parseAIInput('```text\n' + aiRecord + '\n```', [folder]), parsed);
});

test('AI input rejects invented folders, extra records, malformed quotes and bounded input', () => {
  for (const input of ['', 'x'.repeat(aiInputLimit + 1), 'Haus||house', aiRecord + '\n' + aiRecord,
    aiRecord.replace('Everyday', 'Invented'), aiRecord.replace('word||Haus', 'word||"Haus')]) {
    assert.throws(() => parseAIInput(input, [folder]));
  }
});

test('CSV import accepts quoted Unicode and multiline fields with optional columns', async () => {
  const csv = '\uFEFFterm,translation,article,example\r\n"Ha\u0308user",houses,die,"First line\nSecond line"';
  const cards = await importCSV(new File([csv], 'cards.csv'), folder.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].term, 'Häuser');
  assert.equal(cards[0].partOfSpeech, 'noun');
  assert.equal(cards[0].example, 'First line\nSecond line');
  assert.equal(cards[0].folderId, folder.id);
});

test('CSV import enforces bytes, rows, fields and atomic validation', async () => {
  for (const csv of ['word,meaning\nHaus,house', 'term,translation\n',
    'term,translation\n"unterminated,house', 'term,translation\nHaus,house,extra',
    'term,translation\nHaus,house\n,missing', 'term,translation\n' + 'Haus,house\n'.repeat(501)]) {
    await assert.rejects(importCSV(new File([csv], 'invalid.csv'), null));
  }
  await assert.rejects(importCSV(new File(['x'.repeat(1_048_577)], 'large.csv'), null), /1 MiB/);
  assert.equal((await importCSV(new File(['term,translation\n' + 'Haus,house\n'.repeat(500)], 'full.csv'), null)).length, 500);
});

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
}

test('CSV export escapes spreadsheet formulae and releases its Blob URL', async t => {
  let blob;
  let clicked = false;
  const link = { click: () => { clicked = true; } };
  replaceGlobal(t, 'document', { createElement: tag => { assert.equal(tag, 'a'); return link; } });
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:test'; });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  downloadCSV([{ ...word, term: '=SUM(1,2)', translation: '@formula' }], 'dictionary');
  assert.equal(clicked, true);
  assert.equal(link.download, 'dictionary.csv');
  assert.equal(link.href, 'blob:test');
  assert.ok((await blob.text()).includes("'=SUM(1,2)"));
  assert.ok((await blob.text()).includes("'@formula"));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(revoke.mock.calls.length, 1);
});

test('pronunciation replaces owned speech, ignores old completion and stops on disposal', t => {
  const spoken = [];
  let cancelled = 0;
  const germanVoice = { lang: 'de-DE' };
  replaceGlobal(t, 'SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
  replaceGlobal(t, 'speechSynthesis', { getVoices: () => [{ lang: 'en-US' }, germanVoice], speak: value => spoken.push(value), cancel: () => cancelled++ });
  const pronunciation = new Pronunciation();
  assert.equal(pronunciation.speak('Haus'), true);
  assert.equal(spoken[0].voice, germanVoice);
  assert.equal(spoken[0].lang, 'de-DE');
  assert.equal(spoken[0].rate, 0.85);
  pronunciation.speak('Buch');
  assert.equal(cancelled, 1);
  spoken[0].onend();
  pronunciation.dispose();
  assert.equal(cancelled, 2, 'An obsolete callback cannot clear current speech');
  assert.equal(pronunciation.speak('Never spoken'), false);
  assert.equal(spoken.length, 2);
});

test('pronunciation degrades gracefully when the browser has no speech API', t => {
  replaceGlobal(t, 'speechSynthesis', undefined);
  const pronunciation = new Pronunciation();
  assert.equal(pronunciation.speak('Haus'), false);
  pronunciation.dispose();
});

const fixture = JSON.parse(readFileSync(new URL('../services/kerno/internal/lingvo/testdata/fsrs-schedules.json', import.meta.url), 'utf8'));
test('browser FSRS adapter matches the shared eight-state reference without changing input', async t => {
  assert.equal(fixture.cases.length, 8);
  for (const scenario of fixture.cases) {
    await t.test(scenario.name, () => {
      const input = structuredClone(scenario.card);
      const previews = reviewPreviews(input, new Date(scenario.now));
      for (const rating of [1, 2, 3, 4]) {
        const card = previews[rating].card;
        const actual = { due: card.due.toISOString(), stability: card.stability, difficulty: card.difficulty,
          scheduledDays: card.scheduled_days, reps: card.reps, lapses: card.lapses, state: card.state,
          lastReview: card.last_review?.toISOString() ?? null, learningSteps: card.learning_steps };
        assert.deepEqual(actual, scenario.expected[rating]);
        assert.ok(card.scheduled_days <= 36500);
      }
      assert.deepEqual(input, scenario.card);
    });
  }
});

test('review interval labels stay compact across short-term and mature cards', () => {
  const fresh = fixture.cases[0];
  const labels = reviewIntervals(fresh.card, new Date(fresh.now));
  assert.deepEqual(labels, { 1: '1m', 2: '6m', 3: '10m', 4: '8d' });
  for (const scenario of fixture.cases) {
    for (const label of Object.values(reviewIntervals(scenario.card, new Date(scenario.now)))) {
      assert.match(label, /^\d+(m|h|d|mo|y)$/);
    }
  }
});
