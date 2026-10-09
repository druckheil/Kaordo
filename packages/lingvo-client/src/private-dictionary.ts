// Keeps vocabulary, FSRS schedules and learning history in device-encrypted private records
import type {
	LingvoCard,
	LingvoCardContent,
	LingvoDictionary,
	LingvoNewDictionary,
	LingvoSettings,
	LingvoFolder,
	LingvoOverview,
	LingvoCounts,
	LingvoNewCard,
	LingvoCardUpdate,
	LingvoImport,
	LingvoReview,
	LingvoReviewResult,
	LingvoSchedule,
	LingvoCatalog
} from '@kaordo/contracts';
import type { Grade } from 'ts-fsrs';

interface Record<T> {
	id: string;
	revision: number;
	value: T;
}
interface RecordRepository {
	tag(id: string): Promise<string>;
	read<T>(ids: string[], signal?: AbortSignal): Promise<Record<T>[]>;
	commit(
		writes: { id: string; revision: number; value: unknown }[],
		deletes?: { id: string; revision: number }[],
		signal?: AbortSignal
	): Promise<Record<unknown>[]>;
}
interface DictionaryState {
	version: 1;
	dictionary: LingvoDictionary;
	folders: LingvoFolder[];
	cards: { id: string; revision: number }[];
	activity: { day: string; reviews: number }[];
	totalReviews: number;
	reviewMonths?: string[];
}
interface ReviewState {
	id: string;
	cardId: string;
	previousSchedule: LingvoSchedule;
	resultingRevision: number;
	rating: number;
	direction: string;
	reviewedAt: string;
	undone: boolean;
}
interface Filter {
	kind?: string;
	status?: string;
	folder?: string;
	q?: string;
	offset?: number;
	limit?: number;
}
type CatalogReader = (nativeLanguage: 'en' | 'ru', signal?: AbortSignal) => Promise<LingvoCatalog>;
const indexId = 'dictionaries';
const metaId = (id: string) => `${id}/dictionary`;
const cardId = (dictionary: string, id: string) => `${dictionary}/card/${id}`;
const reviewId = (dictionary: string, id: string) => `${dictionary}/review/${id}`;
const failure = () =>
	new Error('This dictionary changed on another device. Reload before trying again.');

export function createPrivateLingvoClient(
	records: RecordRepository,
	catalog: CatalogReader,
	lifetime?: AbortSignal
) {
	const cached = new Map<string, Record<LingvoCard>>();
	lifetime?.addEventListener('abort', () => cached.clear(), { once: true });
	async function readOne<T>(id: string, signal?: AbortSignal) {
		return (await records.read<T>([id], signal))[0] ?? null;
	}
	async function index(signal?: AbortSignal): Promise<Record<LingvoDictionary[]>> {
		return (
			(await readOne<LingvoDictionary[]>(indexId, signal)) ?? {
				id: indexId,
				revision: 0,
				value: []
			}
		);
	}
	async function load(
		id: string,
		signal?: AbortSignal
	): Promise<{ meta: Record<DictionaryState>; cards: Record<LingvoCard>[] }> {
		const meta = await readOne<DictionaryState>(metaId(id), signal);
		if (!meta || meta.value.version !== 1 || meta.value.dictionary.id !== id)
			throw new Error('Dictionary not found.');
		const missing = meta.value.cards.filter(
			(item) => cached.get(cardId(id, item.id))?.revision !== item.revision
		);
		for (let offset = 0; offset < missing.length; offset += 500) {
			signal?.throwIfAborted();
			const loaded = await records.read<LingvoCard>(
				missing.slice(offset, offset + 500).map((item) => cardId(id, item.id)),
				signal
			);
			for (const item of loaded) cached.set(item.id, item);
		}
		const cards = meta.value.cards.flatMap((item) => {
			const stored = cached.get(cardId(id, item.id));
			return stored ? [structuredClone(stored)] : [];
		});
		if (cards.length !== meta.value.cards.length)
			throw new Error('An encrypted dictionary card is unavailable.');
		return { meta, cards };
	}
	async function commit(
		meta: Record<DictionaryState>,
		writes: Record<unknown>[] = [],
		deletes: Record<unknown>[] = [],
		signal?: AbortSignal
	) {
		const prefix = `${meta.value.dictionary.id}/card/`;
		for (const item of writes) {
			if (!item.id.startsWith(prefix)) continue;
			const id = item.id.slice(prefix.length);
			meta.value.cards = meta.value.cards.map((card) =>
				card.id === id ? { id, revision: item.revision + 1 } : card
			);
		}
		await records.commit([{ ...meta }, ...writes], deletes, signal);
		meta.revision++;
		for (const item of writes)
			if (item.id.startsWith(prefix))
				cached.set(
					item.id,
					structuredClone({ ...item, revision: item.revision + 1 }) as Record<LingvoCard>
				);
		for (const item of deletes) cached.delete(item.id);
	}
	async function dictionaries(signal?: AbortSignal) {
		const current = await index(signal);
		return { items: current.value };
	}
	async function activityInZone(state: DictionaryState, zone: string, signal?: AbortSignal) {
		const activity = new Map<string, number>();
		const include = (event: ReviewState) => {
			if (event.undone) return;
			const day = dayInZone(new Date(event.reviewedAt), zone);
			activity.set(day, (activity.get(day) ?? 0) + 1);
		};
		const id = state.dictionary.id;
		for (const month of state.reviewMonths ?? []) {
			const log = await readOne<string[]>(`${id}/review-month/${month}`, signal);
			if (!log) throw new Error('An encrypted review index is unavailable.');
			for (let offset = 0; offset < log.value.length; offset += 500) {
				const events = await records.read<ReviewState>(
					log.value.slice(offset, offset + 500).map((event) => reviewId(id, event)),
					signal
				);
				if (events.length !== Math.min(500, log.value.length - offset))
					throw new Error('An encrypted review event is unavailable.');
				events.forEach((event) => include(event.value));
			}
		}
		return activity;
	}
	async function createDictionary(
		input: LingvoNewDictionary,
		signal?: AbortSignal
	): Promise<LingvoDictionary> {
		if (input.learningLanguage !== 'de' || !['en', 'ru'].includes(input.nativeLanguage))
			throw new Error('Choose German and a supported native language.');
		new Intl.DateTimeFormat('en', { timeZone: input.timeZone });
		const current = await index(signal);
		const existing = current.value.find(
			(item) =>
				item.learningLanguage === input.learningLanguage &&
				item.nativeLanguage === input.nativeLanguage
		);
		if (existing) return existing;
		if (current.value.length >= 10)
			throw new Error('An account can have up to ten language pairs.');
		const dictionary: LingvoDictionary = {
			...input,
			id: crypto.randomUUID(),
			dailyGoal: 20,
			createdAt: new Date().toISOString()
		};
		const state: DictionaryState = {
			version: 1,
			dictionary,
			folders: [],
			cards: [],
			activity: [],
			totalReviews: 0
		};
		await records.commit(
			[
				{ ...current, value: [...current.value, dictionary] },
				{ id: metaId(dictionary.id), revision: 0, value: state }
			],
			[],
			signal
		);
		return dictionary;
	}
	async function settings(
		id: string,
		input: LingvoSettings,
		signal?: AbortSignal
	): Promise<LingvoDictionary> {
		if (!Number.isInteger(input.dailyGoal) || input.dailyGoal < 5 || input.dailyGoal > 200)
			throw new Error('Choose a daily goal between 5 and 200 reviews.');
		new Intl.DateTimeFormat('en', { timeZone: input.timeZone });
		const current = await index(signal);
		const meta = await readOne<DictionaryState>(metaId(id), signal);
		if (!meta) throw new Error('Dictionary not found.');
		if (meta.value.dictionary.timeZone !== input.timeZone) {
			const activity = await activityInZone(meta.value, input.timeZone, signal);
			meta.value.activity = [...activity].map(([day, reviews]) => ({ day, reviews }));
			meta.value.totalReviews = [...activity.values()].reduce((sum, count) => sum + count, 0);
		}
		meta.value.dictionary = { ...meta.value.dictionary, ...input };
		await records.commit(
			[
				{ ...meta },
				{
					...current,
					value: current.value.map((item) => (item.id === id ? meta.value.dictionary : item))
				}
			],
			[],
			signal
		);
		return meta.value.dictionary;
	}
	async function overview(id: string, signal?: AbortSignal): Promise<LingvoOverview> {
		const { meta, cards } = await load(id, signal);
		const value = meta.value;
		const today = dayInZone(new Date(), value.dictionary.timeZone);
		const activity = Array.from({ length: 28 }, (_, index) => {
			const day = new Date(Date.parse(today + 'T12:00:00Z') - (27 - index) * 86400000)
				.toISOString()
				.slice(0, 10);
			return { day, reviews: value.activity.find((item) => item.day === day)?.reviews ?? 0 };
		});
		return {
			dictionary: value.dictionary,
			folders: value.folders,
			activity,
			today,
			totalReviews: value.totalReviews,
			studiedToday: value.activity.find((item) => item.day === today)?.reviews ?? 0,
			streak: streak(value.activity, today),
			counts: ['word', 'phrase'].map((kind) =>
				counts(
					kind as 'word' | 'phrase',
					cards.map((card) => card.value)
				)
			)
		};
	}
	async function cards(id: string, filter: Filter, signal?: AbortSignal) {
		const data = await load(id, signal);
		const selected = filterCards(
			data.cards.map((item) => item.value),
			filter
		).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
		return {
			items: selected.slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 30)),
			total: selected.length
		};
	}
	async function study(id: string, kind: 'word' | 'phrase', folder?: string, signal?: AbortSignal) {
		const data = await load(id, signal);
		return {
			items: filterCards(
				data.cards.map((item) => item.value),
				{ kind, folder, status: 'active' }
			)
				.filter((card) => Date.parse(card.schedule.due) <= Date.now())
				.sort(
					(a, b) =>
						Number(a.schedule.state === 0) - Number(b.schedule.state === 0) ||
						a.schedule.due.localeCompare(b.schedule.due) ||
						a.id.localeCompare(b.id)
				)
				.slice(0, 50)
		};
	}
	async function createCard(
		id: string,
		input: LingvoNewCard,
		signal?: AbortSignal
	): Promise<LingvoCard> {
		const body = normalizeCard(input);
		const data = await load(id, signal);
		const existing = data.cards.find((item) => item.value.id === input.id);
		if (existing) return existing.value;
		validateFolder(data.meta.value, body.folderId);
		if (data.cards.length >= 10000) throw new Error('A dictionary can contain up to 10,000 cards.');
		const { initialSchedule } = await import('./scheduler.ts');
		const card: LingvoCard = {
			...body,
			id: input.id,
			dictionaryId: id,
			sourceKey: null,
			revision: 1,
			createdAt: new Date().toISOString(),
			schedule: initialSchedule()
		};
		data.meta.value.cards.push({ id: card.id, revision: 1 });
		await commit(data.meta, [{ id: cardId(id, card.id), revision: 0, value: card }], [], signal);
		return card;
	}
	async function updateCard(
		id: string,
		itemId: string,
		input: LingvoCardUpdate,
		signal?: AbortSignal
	): Promise<LingvoCard> {
		const data = await load(id, signal);
		const previous = data.cards.find((item) => item.value.id === itemId);
		if (!previous || previous.value.revision !== input.revision) throw failure();
		const body = normalizeCard(input);
		validateFolder(data.meta.value, body.folderId);
		const card = { ...previous.value, ...body, revision: input.revision + 1 };
		if (
			card.kind !== previous.value.kind ||
			card.term !== previous.value.term ||
			card.translation !== previous.value.translation
		)
			card.schedule = (await import('./scheduler.ts')).initialSchedule();
		data.meta.value.cards = data.meta.value.cards.map((item) =>
			item.id === itemId ? { ...item, revision: previous.revision + 1 } : item
		);
		await commit(data.meta, [{ ...previous, value: card }], [], signal);
		return card;
	}
	async function deleteCard(
		id: string,
		itemId: string,
		revision: number,
		signal?: AbortSignal
	): Promise<void> {
		const data = await load(id, signal);
		const previous = data.cards.find((item) => item.value.id === itemId);
		if (!previous || previous.value.revision !== revision) throw failure();
		data.meta.value.cards = data.meta.value.cards.filter((item) => item.id !== itemId);
		await commit(data.meta, [], [previous], signal);
	}
	async function createFolder(
		id: string,
		name: string,
		signal?: AbortSignal
	): Promise<LingvoFolder> {
		name = name.normalize('NFC').trim();
		if (!name || [...name].length > 80) throw new Error('Use a folder name with 1–80 characters.');
		const meta = await readOne<DictionaryState>(metaId(id), signal);
		if (!meta) throw new Error('Dictionary not found.');
		if (meta.value.folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase()))
			throw new Error('A folder with this name already exists.');
		if (meta.value.folders.length >= 100)
			throw new Error('A dictionary can have up to 100 folders.');
		const folder = { id: crypto.randomUUID(), dictionaryId: id, name };
		meta.value.folders.push(folder);
		await commit(meta, [], [], signal);
		return folder;
	}
	async function deleteFolder(id: string, folder: string, signal?: AbortSignal): Promise<void> {
		const data = await load(id, signal);
		const affected = data.cards.filter((item) => item.value.folderId === folder);
		for (let offset = 0; offset < affected.length; offset += 500) {
			const chunk = affected.slice(offset, offset + 500);
			for (const item of chunk) {
				item.value.folderId = null;
				item.value.revision++;
			}
			await commit(data.meta, chunk, [], signal);
		}
		data.meta.value.folders = data.meta.value.folders.filter((item) => item.id !== folder);
		await commit(data.meta, [], [], signal);
	}
	async function importCards(id: string, input: LingvoImport, signal?: AbortSignal) {
		const cards = input.cards ?? [];
		const keys = input.cardKeys ?? [];
		if (!cards.length || cards.length > 500 || keys.length !== cards.length)
			throw new Error('Import between 1 and 500 cards.');
		const data = await load(id, signal);
		validateFolder(data.meta.value, input.folderId);
		const sourceKeys = new Set(data.cards.map((item) => item.value.sourceKey));
		const writes: Record<LingvoCard>[] = [];
		let skipped = 0;
		const { initialSchedule } = await import('./scheduler.ts');
		cards.forEach((content, index) => {
			const sourceKey = input.setId + '/' + keys[index];
			if (sourceKeys.has(sourceKey)) {
				skipped++;
				return;
			}
			sourceKeys.add(sourceKey);
			const card: LingvoCard = {
				...normalizeCard({
					...content,
					folderId: input.folderId ?? null,
					status: input.status ?? 'active'
				}),
				id: crypto.randomUUID(),
				dictionaryId: id,
				sourceKey,
				revision: 1,
				schedule: initialSchedule(),
				createdAt: new Date().toISOString()
			};
			writes.push({ id: cardId(id, card.id), revision: 0, value: card });
			data.meta.value.cards.push({ id: card.id, revision: 1 });
		});
		if (data.meta.value.cards.length > 10000)
			throw new Error('A dictionary can contain up to 10,000 cards.');
		if (writes.length) await commit(data.meta, writes, [], signal);
		return { added: writes.length, skipped };
	}
	async function review(
		id: string,
		itemId: string,
		input: LingvoReview,
		signal?: AbortSignal
	): Promise<LingvoReviewResult> {
		if (![1, 2, 3, 4].includes(input.rating)) throw new Error('Choose a valid review rating.');
		if (!['recognition', 'recall', 'listening', 'phrase'].includes(input.direction))
			throw new Error('Choose a valid review direction.');
		const data = await load(id, signal);
		const card = data.cards.find((item) => item.value.id === itemId);
		if (!card) throw new Error('Card not found.');
		const previous = await readOne<ReviewState>(reviewId(id, input.id), signal);
		if (previous) {
			if (
				previous.value.cardId !== itemId ||
				previous.value.resultingRevision !== input.revision + 1 ||
				previous.value.rating !== input.rating ||
				previous.value.direction !== input.direction ||
				previous.value.undone
			)
				throw failure();
			return { id: input.id, card: card.value };
		}
		if (
			card.value.revision !== input.revision ||
			card.value.status !== 'active' ||
			Date.parse(card.value.schedule.due) > Date.now() + 2000 ||
			(card.value.kind === 'phrase') !== (input.direction === 'phrase')
		)
			throw failure();
		const now = new Date();
		const event: ReviewState = {
			id: input.id,
			cardId: itemId,
			previousSchedule: card.value.schedule,
			resultingRevision: card.value.revision + 1,
			rating: input.rating,
			direction: input.direction,
			reviewedAt: now.toISOString(),
			undone: false
		};
		card.value = {
			...card.value,
			schedule: (await import('./scheduler.ts')).nextSchedule(
				card.value.schedule,
				input.rating as Grade,
				now
			),
			revision: card.value.revision + 1
		};
		changeActivity(data.meta.value, dayInZone(now, data.meta.value.dictionary.timeZone), 1);
		const month = now.toISOString().slice(0, 7);
		const monthId = `${id}/review-month/${month}`;
		const log = (await readOne<string[]>(monthId, signal)) ?? {
			id: monthId,
			revision: 0,
			value: []
		};
		log.value.push(input.id);
		data.meta.value.reviewMonths = [...new Set([...(data.meta.value.reviewMonths ?? []), month])];
		await commit(
			data.meta,
			[card, { id: reviewId(id, input.id), revision: 0, value: event }, log],
			[],
			signal
		);
		return { id: input.id, card: card.value };
	}
	async function undo(id: string, eventId: string, signal?: AbortSignal): Promise<LingvoCard> {
		const data = await load(id, signal);
		const event = await readOne<ReviewState>(reviewId(id, eventId), signal);
		if (!event) throw new Error('Review not found.');
		const card = data.cards.find((item) => item.value.id === event.value.cardId);
		if (!card) throw new Error('Card not found.');
		if (event.value.undone) {
			if (card.value.revision !== event.value.resultingRevision + 1) throw failure();
			return card.value;
		}
		if (
			card.value.revision !== event.value.resultingRevision ||
			Date.now() - Date.parse(event.value.reviewedAt) > 600000
		)
			throw failure();
		card.value = {
			...card.value,
			schedule: event.value.previousSchedule,
			revision: card.value.revision + 1
		};
		event.value.undone = true;
		changeActivity(
			data.meta.value,
			dayInZone(new Date(event.value.reviewedAt), data.meta.value.dictionary.timeZone),
			-1
		);
		await commit(data.meta, [card, event], [], signal);
		return card.value;
	}
	return {
		dictionaries,
		createDictionary,
		overview,
		settings,
		cards,
		study,
		createCard,
		updateCard,
		deleteCard,
		createFolder,
		deleteFolder,
		importCards,
		review,
		undo,
		catalog
	};
}

function normalizeCard(input: LingvoCardContent): LingvoCardContent {
	const card = { ...input };
	for (const key of [
		'term',
		'translation',
		'plural',
		'grammar',
		'example',
		'exampleTranslation',
		'notes'
	] as const)
		card[key] = card[key].normalize('NFC').trim();
	const fields = [
		[card.term, 1, 300],
		[card.translation, 1, 500],
		[card.plural, 0, 100],
		[card.grammar, 0, 500],
		[card.example, 0, 500],
		[card.exampleTranslation, 0, 500],
		[card.notes, 0, 1000]
	] as const;
	if (
		fields.some(
			([value, min, max]) =>
				[...value].length < min ||
				[...value].length > max ||
				/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
		)
	)
		throw new Error('Card text is empty, too long or contains unsupported control characters.');
	if (
		!['word', 'phrase'].includes(card.kind) ||
		!['active', 'known', 'suspended'].includes(card.status) ||
		!['', 'noun', 'verb', 'adjective', 'adverb', 'other'].includes(card.partOfSpeech) ||
		(card.article &&
			(card.kind !== 'word' ||
				card.partOfSpeech !== 'noun' ||
				!['der', 'die', 'das'].includes(card.article)))
	)
		throw new Error('Choose valid German card details.');
	return card;
}
function validateFolder(state: DictionaryState, id: string | null | undefined) {
	if (id && !state.folders.some((folder) => folder.id === id))
		throw new Error('Choose a valid folder.');
}
function filterCards(cards: LingvoCard[], filter: Filter) {
	const q = filter.q?.normalize('NFC').trim().toLowerCase();
	return cards.filter(
		(card) =>
			(!filter.kind || card.kind === filter.kind) &&
			(!filter.status || card.status === filter.status) &&
			(!filter.folder ||
				(filter.folder === 'none' ? !card.folderId : card.folderId === filter.folder)) &&
			(!q || card.term.toLowerCase().includes(q) || card.translation.toLowerCase().includes(q))
	);
}
function counts(kind: 'word' | 'phrase', cards: LingvoCard[]): LingvoCounts {
	const selected = cards.filter((card) => card.kind === kind);
	const active = selected.filter((card) => card.status === 'active');
	return {
		kind,
		total: selected.length,
		due: active.filter((card) => Date.parse(card.schedule.due) <= Date.now()).length,
		new: active.filter((card) => card.schedule.state === 0).length,
		learning: active.filter((card) => [1, 3].includes(card.schedule.state)).length,
		review: active.filter((card) => card.schedule.state === 2).length,
		known: selected.filter((card) => card.status === 'known').length,
		suspended: selected.filter((card) => card.status === 'suspended').length,
		nextDue:
			active
				.map((card) => card.schedule.due)
				.filter((due) => Date.parse(due) > Date.now())
				.sort()[0] ?? null
	};
}
function dayInZone(now: Date, zone: string): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);
	return ['year', 'month', 'day']
		.map((type) => parts.find((part) => part.type === type)?.value)
		.join('-');
}
function changeActivity(state: DictionaryState, day: string, amount: number) {
	let activity = state.activity.find((item) => item.day === day);
	if (!activity) {
		activity = { day, reviews: 0 };
		state.activity.push(activity);
	}
	activity.reviews = Math.max(0, activity.reviews + amount);
	state.totalReviews = Math.max(0, state.totalReviews + amount);
}
function streak(activity: { day: string; reviews: number }[], today: string): number {
	const days = new Set(activity.filter((item) => item.reviews > 0).map((item) => item.day));
	const cursor = new Date(today + 'T00:00:00Z');
	if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
	let total = 0;
	while (days.has(cursor.toISOString().slice(0, 10))) {
		total++;
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}
	return total;
}
