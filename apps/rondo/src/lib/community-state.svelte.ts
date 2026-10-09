// Owns Rondo community queries and server, channel and invitation workflows
import { createQuery, type QueryClient } from '@tanstack/svelte-query';
import {
	ligoUserSearchOptions,
	rondoDiscoverOptions,
	rondoServerOptions,
	rondoServersOptions,
	type LigoApi,
	type RondoApi
} from '@kaordo/api-client';
import type { RondoServer } from '@kaordo/contracts';

export type RondoDialogMode = 'create' | 'discover' | 'channel' | 'invite';

interface CommunityDependencies {
	rondo: RondoApi;
	ligo: Pick<LigoApi, 'searchUsers'>;
	queryClient: QueryClient;
	selectedServerId: () => string | null;
	selectServer: (id: string) => void;
	selectChannel: (id: string | null) => void;
	beforeLeave: (id: string) => Promise<void>;
	onLeft: () => void;
	onActionError: (message: string) => void;
}

export function createRondoCommunityState({
	rondo,
	ligo,
	queryClient,
	selectedServerId: selectedServerIdValue,
	selectServer,
	selectChannel,
	beforeLeave,
	onLeft,
	onActionError
}: CommunityDependencies) {
	let dialog = $state<RondoDialogMode | null>(null);
	let dialogContentMode = $state<RondoDialogMode>('create');
	let dialogBusy = $state(false);
	let dialogError = $state('');
	let serverName = $state('');
	let serverDescription = $state('');
	let serverAccess = $state<'public' | 'private'>('private');
	let channelName = $state('');
	let discoverInput = $state('');
	let discoverTerm = $state('');
	let inviteInput = $state('');
	let inviteTerm = $state('');
	const lifetime = new AbortController();
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let leaveOpen = $state(false);

	const serversQuery = createQuery(
		() => rondoServersOptions(rondo),
		() => queryClient
	);
	const detailQuery = createQuery(
		() => rondoServerOptions(rondo, selectedServerIdValue()),
		() => queryClient
	);
	const discoverQuery = createQuery(
		() => rondoDiscoverOptions(rondo, discoverTerm, dialog === 'discover'),
		() => queryClient
	);
	const inviteQuery = createQuery(
		() => ligoUserSearchOptions(ligo, inviteTerm, dialog === 'invite'),
		() => queryClient
	);
	const servers = $derived(serversQuery.data?.items ?? []);
	const detail = $derived(detailQuery.data ?? null);
	const inviteCandidates = $derived(
		(inviteQuery.data?.items ?? []).filter(
			(candidate) => !detail?.members.some((member) => member.id === candidate.id)
		)
	);

	function openDialog(mode: RondoDialogMode | null) {
		dialog = mode;
		if (mode) dialogContentMode = mode;
		dialogError = '';
		discoverTerm = '';
		discoverInput = '';
		inviteTerm = '';
		inviteInput = '';
	}
	function search(value: string, kind: 'discover' | 'invite') {
		if (searchTimer) clearTimeout(searchTimer);
		if (kind === 'discover') discoverInput = value;
		else inviteInput = value;
		searchTimer = setTimeout(() => {
			if (kind === 'discover') discoverTerm = value.trim();
			else inviteTerm = value.trim();
		}, 220);
	}
	async function createServer() {
		const name = serverName.trim();
		if (!name) return;
		const input = { name, description: serverDescription.trim(), access: serverAccess };

		await runDialogAction(async () => {
			const created = await rondo.create(input, lifetime.signal);
			lifetime.signal.throwIfAborted();
			queryClient.setQueryData(['rondo', 'server', created.server.id], created);
			await queryClient.invalidateQueries({ queryKey: ['rondo', 'servers'] });
			lifetime.signal.throwIfAborted();
			dialog = null;
			serverName = '';
			serverDescription = '';
			selectServer(created.server.id);
			selectChannel(created.channels[0]?.id ?? null);
		});
	}

	async function joinServer(item: RondoServer) {
		await runDialogAction(async () => {
			const joined = await rondo.join(item.id, lifetime.signal);
			lifetime.signal.throwIfAborted();
			queryClient.setQueryData(['rondo', 'server', item.id], joined);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['rondo', 'servers'] }),
				queryClient.invalidateQueries({ queryKey: ['rondo', 'discover'] })
			]);
			lifetime.signal.throwIfAborted();
			dialog = null;
			selectServer(item.id);
			selectChannel(joined.channels[0]?.id ?? null);
		});
	}

	async function createChannel() {
		const selectedServerId = selectedServerIdValue();
		const name = channelName.trim();
		if (!selectedServerId || !name) return;

		await runDialogAction(async () => {
			const created = await rondo.createChannel(selectedServerId, name, lifetime.signal);
			lifetime.signal.throwIfAborted();
			await queryClient.invalidateQueries({ queryKey: ['rondo', 'server', selectedServerId] });
			lifetime.signal.throwIfAborted();
			dialog = null;
			channelName = '';
			selectChannel(created.id);
		});
	}

	async function invite(userId: string) {
		const selectedServerId = selectedServerIdValue();
		if (!selectedServerId) return;

		await runDialogAction(async () => {
			const updated = await rondo.invite(selectedServerId, userId, lifetime.signal);
			lifetime.signal.throwIfAborted();
			queryClient.setQueryData(['rondo', 'server', selectedServerId], updated);
			dialog = null;
		});
	}

	async function runDialogAction(action: () => Promise<void>): Promise<void> {
		if (dialogBusy) return;

		dialogBusy = true;
		dialogError = '';
		try {
			lifetime.signal.throwIfAborted();
			await action();
		} catch (error) {
			if (!lifetime.signal.aborted) dialogError = errorMessage(error);
		} finally {
			if (!lifetime.signal.aborted) dialogBusy = false;
		}
	}

	async function leaveServer() {
		const serverToLeave = selectedServerIdValue();
		if (!serverToLeave || dialogBusy) return;

		dialogBusy = true;
		try {
			lifetime.signal.throwIfAborted();
			await beforeLeave(serverToLeave);
			await rondo.leave(serverToLeave, lifetime.signal);
			lifetime.signal.throwIfAborted();
			queryClient.removeQueries({ queryKey: ['rondo', 'server', serverToLeave] });
			await queryClient.invalidateQueries({ queryKey: ['rondo', 'servers'] });
			lifetime.signal.throwIfAborted();
			onLeft();
			leaveOpen = false;
		} catch (error) {
			if (!lifetime.signal.aborted) onActionError(errorMessage(error));
		} finally {
			if (!lifetime.signal.aborted) dialogBusy = false;
		}
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : 'Please try again.';
	}
	function handleDialogOpenChange(open: boolean): void {
		if (!open && !dialogBusy) dialog = null;
	}
	return {
		serversQuery,
		detailQuery,
		discoverQuery,
		inviteQuery,
		get servers() {
			return servers;
		},
		get detail() {
			return detail;
		},
		get inviteCandidates() {
			return inviteCandidates;
		},
		get dialog() {
			return dialog;
		},
		get dialogContentMode() {
			return dialogContentMode;
		},
		get dialogBusy() {
			return dialogBusy;
		},
		get dialogError() {
			return dialogError;
		},
		get serverName() {
			return serverName;
		},
		set serverName(value: string) {
			serverName = value;
		},
		get serverDescription() {
			return serverDescription;
		},
		set serverDescription(value: string) {
			serverDescription = value;
		},
		get serverAccess() {
			return serverAccess;
		},
		set serverAccess(value: 'public' | 'private') {
			serverAccess = value;
		},
		get channelName() {
			return channelName;
		},
		set channelName(value: string) {
			channelName = value;
		},
		get discoverInput() {
			return discoverInput;
		},
		get discoverTerm() {
			return discoverTerm;
		},
		get inviteInput() {
			return inviteInput;
		},
		get inviteTerm() {
			return inviteTerm;
		},
		get leaveOpen() {
			return leaveOpen;
		},
		set leaveOpen(value: boolean) {
			leaveOpen = value;
		},
		openDialog,
		search,
		createServer,
		joinServer,
		createChannel,
		invite,
		leaveServer,
		handleDialogOpenChange,
		dispose() {
			lifetime.abort();
			if (searchTimer) clearTimeout(searchTimer);
		}
	};
}

export type RondoCommunityState = ReturnType<typeof createRondoCommunityState>;
