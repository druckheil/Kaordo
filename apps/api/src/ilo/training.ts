export const ILO_TASKS = ['de_to_native', 'native_to_de', 'cloze_example'] as const;
export const ILO_SRS_SECONDS = [
  0,
  600,
  3_600,
  86_400,
  259_200,
  604_800,
  1_209_600,
  2_592_000,
  31_536_000,
] as const;

export type IloTask = typeof ILO_TASKS[number];

export type IloTrainingSource = {
  article: string;
  example: string;
  german: string;
  id: string;
  plural: string;
  stage: number;
  theme: string;
  translation: string;
};

const SEPARABLE_PREFIXES = [
  'zurück', 'weiter', 'statt', 'fern', 'fest', 'fort', 'teil',
  'auf', 'aus', 'her', 'hin', 'los', 'mit', 'nach', 'vor', 'weg',
  'ab', 'an', 'ein', 'zu',
] as const;
const GERMAN_TOKEN = /[A-Za-zÄÖÜäöüß]+/gu;

export function buildTrainingCard(card: IloTrainingSource, nativeLabel: string) {
  const task = selectTask(card);
  const german = germanSurface(card);
  const languageLabel = sentenceCase(nativeLabel.trim() || 'your language');
  const answerLines = [
    `German: ${german}`,
    `Meaning: ${card.translation}`,
    card.example ? `Example: ${card.example}` : '',
    card.plural ? `Plural: ${card.plural}` : '',
    card.theme ? `Theme: ${card.theme}` : '',
  ].filter(Boolean);

  if (task === 'native_to_de') {
    return {
      answerLines,
      id: card.id,
      promptText: card.translation,
      promptTitle: 'Translate to German',
      stage: card.stage,
      task,
    };
  }

  if (task === 'cloze_example') {
    const cloze = buildClozePrompt(card);
    return {
      answerLines,
      id: card.id,
      promptText: `${card.translation}\n${cloze?.masked ?? card.example}`.trim(),
      promptTitle: 'Fill the missing German expression',
      stage: card.stage,
      task,
    };
  }

  return {
    answerLines,
    id: card.id,
    promptText: german,
    promptTitle: `Translate to ${languageLabel}`,
    stage: card.stage,
    task,
  };
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
}

export function selectTask(card: IloTrainingSource): IloTask {
  const preferred = ILO_TASKS[card.stage % ILO_TASKS.length] ?? 'de_to_native';
  if (preferred !== 'cloze_example' || buildClozePrompt(card)) return preferred;
  return 'de_to_native';
}

export function buildClozePrompt(card: Pick<IloTrainingSource, 'example' | 'german' | 'translation'>): {
  masked: string;
  translation: string;
} | null {
  const example = card.example.trim();
  const german = card.german.trim();
  if (!example || !german) return null;

  const escaped = escapeRegExp(german);
  const exactPattern = new RegExp(`(?<![A-Za-zÄÖÜäöüß])${escaped}(?![A-Za-zÄÖÜäöüß])`, 'iu');
  if (exactPattern.test(example)) {
    return { masked: example.replace(exactPattern, '____'), translation: card.translation.trim() };
  }

  const split = splitSeparableInfinitive(german);
  if (!split) return null;
  const [prefix, stem] = split;
  const spans: Array<{ end: number; start: number }> = [];
  let prefixFound = false;
  let stemFound = false;
  for (const match of example.matchAll(GERMAN_TOKEN)) {
    const token = germanKey(match[0]);
    const start = match.index;
    if (start === undefined) continue;
    if (!prefixFound && token === prefix) {
      spans.push({ end: start + match[0].length, start });
      prefixFound = true;
    } else if (!stemFound && token.startsWith(stem)) {
      spans.push({ end: start + match[0].length, start });
      stemFound = true;
    }
  }
  if (!prefixFound || !stemFound || spans[0]?.start === spans[1]?.start) return null;

  let masked = example;
  for (const span of spans.sort((left, right) => right.start - left.start)) {
    masked = `${masked.slice(0, span.start)}____${masked.slice(span.end)}`;
  }
  return { masked, translation: card.translation.trim() };
}

function germanSurface(card: Pick<IloTrainingSource, 'article' | 'german'>): string {
  return card.article.trim() ? `${card.article.trim()} ${card.german.trim()}` : card.german.trim();
}

function splitSeparableInfinitive(value: string): readonly [string, string] | null {
  const word = germanKey(value.trim());
  if (!word || word.includes(' ')) return null;
  for (const prefix of SEPARABLE_PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const base = word.slice(prefix.length);
    const stem = base.endsWith('en') ? base.slice(0, -2) : base.endsWith('n') ? base.slice(0, -1) : '';
    if (stem.length >= 3) return [prefix, stem];
  }
  return null;
}

function germanKey(value: string): string {
  return value.toLocaleLowerCase('de-DE')
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
