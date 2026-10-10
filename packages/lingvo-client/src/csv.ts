// Parses bounded CSV vocabulary imports and exports escaped personal card content
import Papa from 'papaparse';
import type { LingvoCardContent } from '@kaordo/contracts';
import { cardInputColumns, parseCardInput } from './card-input.ts';

export async function importCSV(file: File, folderId: string | null): Promise<LingvoCardContent[]> {
	if (file.size > 1_048_576) throw new Error('Choose a CSV file smaller than 1 MiB.');
	const result = Papa.parse<Record<string, string>>(await file.text(), {
		header: true,
		skipEmptyLines: 'greedy',
		transformHeader: (header) => header.trim()
	});
	if (result.errors.length)
		throw new Error('Could not read the CSV. Check quotes and column counts.');
	if (!result.meta.fields?.includes('term') || !result.meta.fields.includes('translation')) {
		throw new Error(
			'The CSV needs term and translation column headers. Other columns are optional.'
		);
	}
	if (result.data.length < 1 || result.data.length > 500)
		throw new Error('Import between 1 and 500 cards at a time.');
	return result.data.map((row, index) => {
		try {
			return parseCardInput(row, folderId);
		} catch (cause) {
			throw new Error(
				`Row ${index + 2}: ${cause instanceof Error ? cause.message : 'Invalid card content.'}`,
				{ cause }
			);
		}
	});
}

export function downloadCSV(cards: LingvoCardContent[], name: string): void {
	const csv = Papa.unparse(
		{
			fields: [...cardInputColumns],
			data: cards.map((card) => cardInputColumns.map((key) => card[key]))
		},
		{
			escapeFormulae: true,
			newline: '\r\n'
		}
	);
	const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name + '.csv';
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
