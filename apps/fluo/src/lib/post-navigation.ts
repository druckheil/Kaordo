// Parses post links and validates dialog return locations

import type { FluoView } from "./fluo-model";
import { fluoViewFromHash, isFluoView, postIdFromHash } from "./fluo-model";

const postHistoryKeys = ["kaordoFluoPost", "kaordoFluoReturnView", "kaordoFluoReturnHash"] as const;

export interface PostCloseDestination {
	view: FluoView;
	hash: string;
	returnThroughHistory: boolean;
	cleanState: Record<string, unknown>;
}

export function postCloseDestination(
	state: unknown,
	fallbackView: FluoView,
	historySession: string,
): PostCloseDestination {
	const historyState = asHistoryState(state);
	const view = isFluoView(historyState.kaordoFluoReturnView)
		? historyState.kaordoFluoReturnView
		: fallbackView;
	const storedHash = historyState.kaordoFluoReturnHash;
	const hash = isValidReturnHash(storedHash) ? storedHash : `#${view}`;
	const returnThroughHistory = Boolean(historySession) && historyState.kaordoFluoPost === historySession;
	const cleanState = { ...historyState };

	for (const key of postHistoryKeys) delete cleanState[key];

	return { view, hash, returnThroughHistory, cleanState };
}

export function viewFromPostHistory(state: unknown): FluoView | null {
	const historyState = asHistoryState(state);
	return isFluoView(historyState.kaordoFluoReturnView)
		? historyState.kaordoFluoReturnView
		: null;
}

function isValidReturnHash(value: unknown): value is string {
	if (typeof value !== "string") return false;
	return fluoViewFromHash(value) !== null || postIdFromHash(value) !== null;
}

function asHistoryState(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}
