// Validates imported card content consistently across CSV and AI-assisted entry
import type { LingvoCardContent } from '@kaordo/contracts';
import { emptyCard } from './index.ts';

export const cardInputColumns = [
	'kind',
	'term',
	'translation',
	'partOfSpeech',
	'article',
	'plural',
	'grammar',
	'example',
	'exampleTranslation',
	'notes',
	'status'
] as const;
export const cardTextLimits = {
	term: 300,
	translation: 500,
	plural: 100,
	grammar: 500,
	example: 500,
	exampleTranslation: 500,
	notes: 1000
} as const;

export function parseCardInput(
	row: Record<string, string | undefined>,
	folderId: string | null
): LingvoCardContent {
	const kind = row.kind?.trim() || 'word';
	const status = row.status?.trim() || 'active';
	const article = row.article?.trim() || '';
	const part = row.partOfSpeech?.trim() || (article ? 'noun' : '');
	if (kind !== 'word' && kind !== 'phrase') throw new Error('Kind must be word or phrase.');
	if (!['active', 'known', 'suspended'].includes(status))
		throw new Error('Status must be active, known or suspended.');
	if (!['', 'noun', 'verb', 'adjective', 'adverb', 'other'].includes(part))
		throw new Error('Use a valid part of speech.');
	if (!['', 'der', 'die', 'das'].includes(article))
		throw new Error('Article must be der, die, das or empty.');
	if (article && (kind !== 'word' || part !== 'noun'))
		throw new Error('Articles belong to noun cards.');

	const card = emptyCard(kind, folderId);
	for (const key of cardInputColumns)
		if (row[key] !== undefined) Object.assign(card, { [key]: row[key].normalize('NFC').trim() });
	card.kind = kind;
	card.status = status as LingvoCardContent['status'];
	card.partOfSpeech = part as LingvoCardContent['partOfSpeech'];
	card.article = article as LingvoCardContent['article'];
	if (!card.term || !card.translation)
		throw new Error('A German word or phrase and its translation are required.');
	for (const key of Object.keys(cardTextLimits) as (keyof typeof cardTextLimits)[]) {
		const text = card[key];
		if (Array.from(text).length > cardTextLimits[key] || /(?![\t\n])\p{Cc}/u.test(text)) {
			throw new Error(
				`${key} must contain valid text of at most ${cardTextLimits[key]} characters.`
			);
		}
	}
	return card;
}
