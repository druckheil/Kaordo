// Generates language-aware AI prompts and parses one validated card template
import Papa from 'papaparse';
import type { LingvoCardContent, LingvoDictionary, LingvoFolder } from '@kaordo/contracts';
import { cardInputColumns, cardTextLimits, parseCardInput } from './card-input.ts';

export const aiInputLimit = 8192;
const columns = [
	'kind',
	'german',
	'translation',
	'folder',
	...cardInputColumns.filter((key) => key !== 'kind' && key !== 'term' && key !== 'translation')
];
const nativeNames = { ru: 'Russian', en: 'English' } as const;

export function cardPrompt(
	card: Pick<LingvoCardContent, 'kind' | 'term' | 'folderId' | 'status'>,
	nativeLanguage: LingvoDictionary['nativeLanguage'],
	folders: readonly LingvoFolder[]
): string {
	const folder = folders.find((item) => item.id === card.folderId)?.name ?? '';
	return [
		'Fill one German language-learning card for Lingvo.',
		'Native language: ' +
			nativeNames[nativeLanguage] +
			'. Write translations, grammar explanations and notes in this language.',
		'Card type: ' + card.kind + '.',
		'German word or phrase: ' +
			(card.term.trim()
				? JSON.stringify(card.term.trim())
				: '[enter your German word or phrase here]'),
		'',
		'Return exactly ONE filled record in this column order:',
		columns.join('||'),
		'',
		'Format: separate fields with ||. Keep empty fields empty, including their separators.',
		'Do not return a header, Markdown or commentary. Use CSV quoting: wrap a field containing ||, quotes or a newline in double quotes and escape each double quote as two double quotes.',
		'',
		'Field rules:',
		'- kind: ' +
			card.kind +
			'. german: the German term without a leading noun article; use the infinitive for verbs.',
		'- translation: a natural ' + nativeNames[nativeLanguage] + ' translation.',
		'- folder: ' +
			(folder
				? 'use ' + JSON.stringify(folder) + '.'
				: 'leave empty unless an appropriate existing folder applies.'),
		'- Existing folder names (use an exact name or leave empty): ' +
			JSON.stringify(folders.map((item) => item.name)) +
			'. Do not invent folders.',
		'- partOfSpeech: noun, verb, adjective, adverb, other or empty. For phrases, leave partOfSpeech, article and plural empty.',
		'- article: der, die or das for a noun; empty otherwise. plural: the German noun plural, including its article when appropriate.',
		'- grammar: useful verb forms, word-order guidance or another short grammar note.',
		'- example: a natural German sentence. exampleTranslation: its ' +
			nativeNames[nativeLanguage] +
			' translation.',
		'- notes: a short useful memory cue, or empty.',
		'- status: ' + card.status + '.',
		'- Text limits: ' +
			Object.entries(cardTextLimits)
				.map(([key, limit]) => `${key === 'term' ? 'german' : key} ${limit}`)
				.join(', ') +
			' characters.',
		'Fill the useful fields accurately; leave inapplicable fields empty.'
	].join('\n');
}

export function parseAIInput(source: string, folders: readonly LingvoFolder[]): LingvoCardContent {
	if (!source.trim() || source.length > aiInputLimit)
		throw new Error('Paste one filled template of at most 8,192 characters.');
	let text = source.trim();
	const fence = /^`{3}(?:[a-z\d_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n`{3}$/i.exec(text);
	if (fence) text = fence[1].trim();
	const parsed = Papa.parse<string[]>(text, { delimiter: '||', skipEmptyLines: 'greedy' });
	if (parsed.errors.length)
		throw new Error('Could not read the template. Check separators and quoted fields.');
	const rows = parsed.data;
	if (
		rows[0]?.length === columns.length &&
		rows[0].every((value, index) => value.trim() === columns[index])
	)
		rows.shift();
	if (rows.length !== 1 || rows[0].length !== columns.length) {
		throw new Error(
			`Use one card with all ${columns.length} fields separated by ||. Copy the prompt for the correct format.`
		);
	}
	const values = Object.fromEntries(
		columns.map((key, index) => [key, rows[0][index].normalize('NFC').trim()])
	);
	const folder = values.folder
		? folders.find((item) => item.name.normalize('NFC') === values.folder)
		: undefined;
	if (values.folder && !folder)
		throw new Error(
			'Folder ' +
				JSON.stringify(values.folder) +
				' does not exist. Use an existing folder name or leave it empty.'
		);
	return parseCardInput({ ...values, term: values.german }, folder?.id ?? null);
}
