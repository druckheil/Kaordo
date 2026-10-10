// Owns the due-card queue, idempotent review requests and saved-progress recovery
import { untrack } from 'svelte';
import { createQuery, type QueryClient } from '@tanstack/svelte-query';
import { lingvoStudyOptions, type LingvoApi } from '@kaordo/api-client';
import type { LingvoCard, LingvoReview } from '@kaordo/contracts';
import { errorMessage, type CardKind } from './lingvo-context';

interface StudyDependencies {
	api: Pick<LingvoApi, 'study' | 'review' | 'undo'>;
	queryClient: QueryClient;
	dictionaryId: () => string;
	kind: () => CardKind;
	folder: () => string;
	onCardChanged: () => void;
	onReviewSaved: () => void;
	changed: (dictionaryId: string) => Promise<void>;
	notify: (message: string) => void;
}

export function createStudyState({
	api,
	queryClient,
	dictionaryId,
	kind,
	folder,
	onCardChanged,
	onReviewSaved,
	changed,
	notify
}: StudyDependencies) {
	const query = createQuery(
		() => lingvoStudyOptions(api, dictionaryId(), kind(), folder() || undefined),
		() => queryClient
	);
	let active = $state<LingvoCard | null>(null);
	let reviewed = $state<Record<string, number>>({});
	let busy = $state(false);
	let completed = $state(0);
	let error = $state('');
	let pending = $state<{ cardId: string; review: LingvoReview } | null>(null);
	let undoId = $state<string | null>(null);
	const lifetime = new AbortController();
	const ready = $derived(
		(query.data?.items ?? []).filter((card) => card.revision > (reviewed[card.id] ?? 0))
	);

	$effect(() => {
		if (active || busy || !ready.length) return;
		const next = ready[0];
		untrack(() => {
			active = next;
			onCardChanged();
		});
	});

	async function perform(action: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			lifetime.signal.throwIfAborted();
			await action();
		} catch (cause) {
			if (!lifetime.signal.aborted) error = errorMessage(cause);
		} finally {
			if (!lifetime.signal.aborted) busy = false;
		}
	}

	async function save(
		direction: LingvoReview['direction'],
		rating?: LingvoReview['rating']
	): Promise<void> {
		if (lifetime.signal.aborted || busy || !active) return;
		if (!pending && rating) {
			pending = {
				cardId: active.id,
				review: { id: crypto.randomUUID(), revision: active.revision, rating, direction }
			};
		}
		if (!pending) return;
		const attempt = pending;
		await perform(async () => {
			error = '';
			const result = await api.review(
				dictionaryId(),
				attempt.cardId,
				attempt.review,
				lifetime.signal
			);
			if (lifetime.signal.aborted) return;
			reviewed = { ...reviewed, [attempt.cardId]: attempt.review.revision };
			undoId = result.id;
			completed += 1;
			pending = null;
			active = null;
			onReviewSaved();
			void changed(dictionaryId());
		});
	}

	async function refresh(): Promise<void> {
		await perform(async () => {
			const result = await query.refetch();
			if (lifetime.signal.aborted) return;
			if (result.error) throw result.error;
			// Resolve an uncertain save before allowing a different answer
			const current = result.data?.items.find(
				(card) => card.id === active?.id && card.revision === active.revision
			);
			pending = null;
			if (!current) {
				active = null;
				onCardChanged();
				notify('Practice refreshed from your saved progress.');
			} else error = '';
			void changed(dictionaryId());
		});
	}

	async function undo(): Promise<void> {
		if (lifetime.signal.aborted || busy || !undoId || pending) return;
		const reviewId = undoId;
		await perform(async () => {
			error = '';
			const restored = await api.undo(dictionaryId(), reviewId, lifetime.signal);
			if (lifetime.signal.aborted) return;
			reviewed = { ...reviewed, [restored.id]: 0 };
			active = restored;
			undoId = null;
			completed = Math.max(0, completed - 1);
			onCardChanged();
			void changed(dictionaryId());
		});
	}

	return {
		query,
		get active() {
			return active;
		},
		get busy() {
			return busy;
		},
		get completed() {
			return completed;
		},
		get error() {
			return error;
		},
		get pending() {
			return pending;
		},
		get undoId() {
			return undoId;
		},
		clearError() {
			error = '';
		},
		save,
		refresh,
		undo,
		dispose() {
			lifetime.abort();
		}
	};
}
