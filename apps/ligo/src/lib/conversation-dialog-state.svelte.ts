// Owns conversation discovery, form state and cancellable create/member commands
import { createQuery, type QueryClient } from '@tanstack/svelte-query';
import { ligoUserSearchOptions, type LigoApi } from '@kaordo/api-client';
import type { LigoConversation, LigoNewConversation, LigoUser } from '@kaordo/contracts';
import { findAvailableUsers, type ConversationDialogMode } from './ligo-model';

export type ConversationDialogApi = Pick<
	LigoApi,
	'searchUsers' | 'createConversation' | 'addMembers'
>;

interface DialogDependencies {
	api: ConversationDialogApi;
	queryClient: QueryClient;
	mode: () => ConversationDialogMode | null;
	selected: () => LigoConversation | null;
	selectedId: () => string | null;
	onClose: () => void;
	onSelect: (id: string) => void;
}

type ConversationCommand =
	| { type: 'create'; input: LigoNewConversation }
	| { type: 'add'; id: string; participantIds: string[] };

export function createConversationDialogState({
	api,
	queryClient,
	mode,
	selected,
	selectedId,
	onClose,
	onSelect
}: DialogDependencies) {
	const form = $state({
		groupMode: false,
		groupTitle: '',
		selectedUsers: [] as LigoUser[],
		searchInput: ''
	});
	let searchTerm = $state('');
	let busy = $state(false);
	let error = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	const lifetime = new AbortController();
	const searchQuery = createQuery(
		() => ligoUserSearchOptions(api, searchTerm, mode() !== null),
		() => queryClient
	);
	const availableUsers = $derived(
		findAvailableUsers(searchQuery.data?.items ?? [], mode() ?? 'new', selected())
	);

	$effect(() => {
		const currentMode = mode();
		if (searchTimer) clearTimeout(searchTimer);
		if (!currentMode) return;
		form.groupMode = currentMode === 'add';
		form.groupTitle = '';
		form.selectedUsers = [];
		form.searchInput = '';
		searchTerm = '';
		error = '';
	});

	function changeSearch(value: string): void {
		form.searchInput = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTerm = value.trim();
		}, 220);
	}

	function toggleUser(candidate: LigoUser): void {
		form.selectedUsers = form.selectedUsers.some((user) => user.id === candidate.id)
			? form.selectedUsers.filter((user) => user.id !== candidate.id)
			: [...form.selectedUsers, candidate];
	}

	async function execute(command: ConversationCommand, fallback: string): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			lifetime.signal.throwIfAborted();
			const conversation =
				command.type === 'add'
					? await api.addMembers(command.id, command.participantIds, lifetime.signal)
					: await api.createConversation(command.input, lifetime.signal);
			lifetime.signal.throwIfAborted();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] }),
				queryClient.invalidateQueries({ queryKey: ['ligo', 'conversation', conversation.id] })
			]);
			lifetime.signal.throwIfAborted();
			onClose();
			onSelect(conversation.id);
		} catch (cause) {
			if (!lifetime.signal.aborted) error = cause instanceof Error ? cause.message : fallback;
		} finally {
			if (!lifetime.signal.aborted) busy = false;
		}
	}

	function startDirectChat(candidate: LigoUser): Promise<void> {
		return execute(
			{ type: 'create', input: { kind: 'duo', participantIds: [candidate.id] } },
			'Could not start the conversation.'
		);
	}

	function confirmGroupChange(): Promise<void> | undefined {
		if (!mode() || !form.selectedUsers.length) return;
		const id = selectedId();
		const participantIds = form.selectedUsers.map((user) => user.id);
		const command: ConversationCommand =
			mode() === 'add' && id
				? { type: 'add', id, participantIds }
				: {
						type: 'create',
						input: { kind: 'group', title: form.groupTitle.trim(), participantIds }
					};
		return execute(command, 'Could not update the conversation.');
	}

	return {
		form,
		searchQuery,
		get searchTerm() {
			return searchTerm;
		},
		get availableUsers() {
			return availableUsers;
		},
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		changeSearch,
		toggleUser,
		startDirectChat,
		confirmGroupChange,
		close(this: void) {
			if (!busy) onClose();
		},
		dispose(this: void) {
			lifetime.abort();
			if (searchTimer) clearTimeout(searchTimer);
		}
	};
}
