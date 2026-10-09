// Parses post links and validates focused-post return locations

import type { FluoView } from './fluo-model';
import {
	fluoViewFromHash,
	isFluoView,
	postIdFromHash,
	profileUsernameFromHash
} from './fluo-model';

const postHistoryKeys = [
	'kaordoFluoPost',
	'kaordoFluoReturnView',
	'kaordoFluoReturnHash',
	'kaordoFluoProfileHash'
] as const;

export interface PostBackDestination {
	view: FluoView;
	hash: string;
	returnThroughHistory: boolean;
	cleanState: Record<string, unknown>;
}

export function postBackDestination(
	state: unknown,
	fallbackView: FluoView,
	historySession: string
): PostBackDestination {
	const historyState = asHistoryState(state);
	const view = isFluoView(historyState.kaordoFluoReturnView)
		? historyState.kaordoFluoReturnView
		: fallbackView;
	const storedHash = historyState.kaordoFluoReturnHash;
	const profileHash = historyState.kaordoFluoProfileHash;
	const fallbackHash =
		view === 'profile' && typeof profileHash === 'string' && profileUsernameFromHash(profileHash)
			? profileHash
			: `#${view}`;
	const hash = isValidReturnHash(storedHash) ? storedHash : fallbackHash;
	const returnThroughHistory =
		Boolean(historySession) && historyState.kaordoFluoPost === historySession;
	const cleanState = Object.fromEntries(
		Object.entries(historyState).filter(
			([key]) => !postHistoryKeys.some((historyKey) => historyKey === key)
		)
	);

	return { view, hash, returnThroughHistory, cleanState };
}

export function viewFromPostHistory(state: unknown): FluoView | null {
	const historyState = asHistoryState(state);
	return isFluoView(historyState.kaordoFluoReturnView) ? historyState.kaordoFluoReturnView : null;
}

function isValidReturnHash(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	return fluoViewFromHash(value) !== null || postIdFromHash(value) !== null;
}

function asHistoryState(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}
