<script lang="ts">
	// Composes Rondo navigation, layout, community state and shared conversation views

	import { onDestroy, onMount, tick } from 'svelte';
	import { pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { createLigoApi, createRondoApi } from '@kaordo/api-client';
	import type { UserIdentity } from '@kaordo/contracts';
	import { createRondoCommunityState, type RondoDialogMode } from './community-state.svelte.ts';
	import RondoCommunityDialogs from './RondoCommunityDialogs.svelte';
	import { createConversationState } from '@kaordo/chat-client';
	import { createRondoVoiceState } from './voice-state.svelte.ts';
	import MessageComposer from '@kaordo/chat-ui/message-composer';
	import type MessageListComponent from '@kaordo/chat-ui/message-list';
	import { appPaths } from '@kaordo/links';
	import {
		formatRondoRoute,
		getInitials as initials,
		parseLayoutPreferences,
		parseRondoRoute
	} from './rondo-state';
	import {
		AppHeader,
		Button,
		ChevronLeftIcon,
		CompassIcon,
		Dialog,
		HashIcon,
		LayoutGridIcon,
		MicIcon,
		PanelLeftIcon,
		PanelRightIcon,
		PlusIcon,
		SettingsIcon,
		UsersIcon,
		UserPlusIcon
	} from '@kaordo/ui';
	import MemberPanel from './MemberPanel.svelte';
	import VoiceStage from './VoiceStage.svelte';
	import DeferredRondoSettings from './DeferredRondoSettings.svelte';

	const maxMessageFiles = 8;

	let { user }: { user: UserIdentity } = $props();
	const rondo = createRondoApi(import.meta.env.VITE_KAORDO_API_URL);
	const ligo = createLigoApi(
		import.meta.env.VITE_KAORDO_API_URL,
		import.meta.env.VITE_KAORDO_NODO_URL
	);
	const queryClient = new QueryClient();
	let serverId = $state<string | null>(null);
	let channelId = $state<string | null>(null);
	let actionError = $state('');
	let draft = $state('');
	let files = $state<File[]>([]);
	let LoadedMessageList = $state<typeof MessageListComponent | null>(null);
	let messageViewError = $state(false);
	let disposed = false;
	let settingsOpen = $state(false);
	let soundsEnabled = $state(true);
	const voiceState = createRondoVoiceState(
		rondo,
		() => serverId,
		() => soundsEnabled
	);
	const voiceConnection = $derived(voiceState.connection);
	const voiceChannelId = $derived(voiceState.channelId);
	const voiceBusy = $derived(voiceState.busy);
	const voice = $derived(voiceState.snapshot);
	const voicePreferences = $derived(voiceState.preferences);
	let serversOpen = $state(true);
	let channelsOpen = $state(true);
	let membersOpen = $state<boolean | null>(null);
	let mobileMembersOpen = $state(false);
	let wideMembers = $state(false);
	let narrowChannels = $state(false);
	let showServersButton = $state<HTMLButtonElement | null>(null);
	let hideServersButton = $state<HTMLButtonElement | null>(null);
	let showChannelsButton = $state<HTMLButtonElement | null>(null);
	let hideChannelsButton = $state<HTMLButtonElement | null>(null);
	let showMembersButton = $state<HTMLButtonElement | null>(null);
	let hideMembersButton = $state<HTMLButtonElement | null>(null);
	let layoutRoot: HTMLElement;

	const community = createRondoCommunityState({
		rondo,
		ligo,
		queryClient,
		selectedServerId: () => serverId,
		selectServer,
		selectChannel,
		beforeLeave: async (id) => {
			if (voiceChannelId && detail?.server.id === id) await voiceState.stop();
		},
		onLeft: () => {
			serverId = null;
			channelId = null;
			syncRoomUrl();
		},
		onActionError: (message) => {
			actionError = message;
		}
	});
	const serversQuery = community.serversQuery;
	const detailQuery = community.detailQuery;
	const servers = $derived(community.servers);
	const detail = $derived(community.detail);
	const channel = $derived(detail?.channels.find((item) => item.id === channelId) ?? null);
	const voiceChannel = $derived(
		detail?.channels.find((item) => item.id === voiceChannelId) ?? null
	);
	const membersVisible = $derived(wideMembers ? (membersOpen ?? true) : mobileMembersOpen);
	const channelsVisible = $derived(channelsOpen && (!narrowChannels || !channelId));
	const chat = createConversationState({
		api: ligo,
		queryClient,
		nodoBaseUrl: import.meta.env.VITE_KAORDO_NODO_URL,
		selectedId: () => channel?.conversationId ?? null,
		sendFailureMessage: 'Please try again.'
	});
	const messagesQuery = chat.query;
	const messages = $derived(chat.messages);
	const activePending = $derived(chat.activePending);
	const liveUnavailable = $derived(chat.liveUnavailable);

	$effect(() => {
		if (!serverId && servers.length) selectServer(servers[0].id);
	});
	$effect(() => {
		if (!channel || LoadedMessageList || messageViewError) return;
		void import('@kaordo/chat-ui/message-list')
			.then(({ default: MessageList }) => {
				if (!disposed) LoadedMessageList = MessageList;
			})
			.catch(() => {
				if (!disposed) messageViewError = true;
			});
	});

	onMount(() => {
		const removeBreakpointListeners = watchBreakpoints();
		restorePreferences();
		const removeRouteListener = watchRouteHash();
		chat.connect();

		return () => {
			removeBreakpointListeners();
			removeRouteListener();
			chat.dispose();
		};
	});
	onDestroy(() => {
		disposed = true;
		chat.dispose();
		community.dispose();
		voiceState.dispose();
		void queryClient.cancelQueries();
		queryClient.clear();
	});

	function watchBreakpoints(): () => void {
		const update = () => {
			const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
			const nextWide = layoutRoot.clientWidth >= 80 * unit;
			if (wideMembers !== nextWide) mobileMembersOpen = false;
			wideMembers = nextWide;
			narrowChannels = layoutRoot.clientWidth < 40 * unit;
		};
		// Panel widths use rem units, so their breakpoints must also follow enlarged text
		const observer = new ResizeObserver(update);
		observer.observe(layoutRoot);
		update();
		return () => observer.disconnect();
	}

	function restorePreferences(): void {
		voiceState.restorePreferences();
		try {
			const saved = parseLayoutPreferences(localStorage.getItem('kaordo-rondo-layout'));
			if (saved.servers !== undefined) serversOpen = saved.servers;
			if (saved.channels !== undefined) channelsOpen = saved.channels;
			if (saved.members !== undefined) membersOpen = saved.members;
			soundsEnabled = localStorage.getItem('kaordo-rondo-sounds') !== 'off';
		} catch {
			// Invalid preferences fall back to the default layout.
		}
	}

	function watchRouteHash(): () => void {
		const syncRoute = () => {
			settingsOpen = window.location.hash === '#settings';
			const route =
				parseRondoRoute(window.location.hash) ??
				(settingsOpen ? parseRondoRoute(page.state.rondoSettingsReturn ?? '') : null);
			if (!route) return;
			if (serverId && serverId !== route.serverId && (voiceConnection || voiceBusy))
				void voiceState.stop();
			serverId = route.serverId;
			channelId = route.channelId;
		};
		syncRoute();
		window.addEventListener('hashchange', syncRoute);
		window.addEventListener('popstate', syncRoute);
		return () => {
			window.removeEventListener('hashchange', syncRoute);
			window.removeEventListener('popstate', syncRoute);
		};
	}

	function openSettings(): void {
		mobileMembersOpen = false;
		pushState('#settings', { ...page.state, rondoSettingsReturn: window.location.hash });
		settingsOpen = true;
	}

	function closeSettings(): void {
		if (page.state.rondoSettingsReturn !== undefined) {
			window.history.back();
			return;
		}
		replaceState(serverId ? `#${formatRondoRoute(serverId, channelId)}` : '', page.state);
		settingsOpen = false;
	}

	function syncRoomUrl(): void {
		if (settingsOpen) return;
		const hash = serverId ? `#${formatRondoRoute(serverId, channelId)}` : '';
		if (window.location.hash !== hash) pushState(hash, page.state);
	}

	function saveLayout() {
		try {
			localStorage.setItem(
				'kaordo-rondo-layout',
				JSON.stringify({
					servers: serversOpen,
					channels: channelsOpen,
					members: membersOpen
				})
			);
		} catch {
			// The current layout remains usable when browser storage is unavailable.
		}
	}
	async function toggleServers() {
		serversOpen = !serversOpen;
		saveLayout();
		await tick();
		(serversOpen ? hideServersButton : showServersButton)?.focus();
	}
	async function toggleChannels() {
		if (narrowChannels && channelId) {
			selectChannel(null);
			channelsOpen = true;
		} else channelsOpen = !channelsOpen;
		saveLayout();
		await tick();
		(channelsVisible ? hideChannelsButton : showChannelsButton)?.focus();
	}
	async function toggleMembers() {
		if (wideMembers) {
			membersOpen = !membersVisible;
			saveLayout();
		} else mobileMembersOpen = !mobileMembersOpen;
		await tick();
		(membersVisible ? hideMembersButton : showMembersButton)?.focus();
	}
	function changeSounds(enabled: boolean) {
		soundsEnabled = enabled;
		voiceConnection?.setSoundEnabled(enabled);
		try {
			localStorage.setItem('kaordo-rondo-sounds', enabled ? 'on' : 'off');
		} catch {
			// The live choice remains usable when browser storage is unavailable
		}
	}
	function selectServer(id: string) {
		if (serverId !== id && (voiceConnection || voiceBusy)) void voiceState.stop();
		serverId = id;
		channelId = null;
		syncRoomUrl();
		actionError = '';
		voiceState.error = '';
		mobileMembersOpen = false;
	}
	function selectChannel(id: string | null) {
		channelId = id;
		syncRoomUrl();
		draft = '';
		files = [];
		actionError = '';
		mobileMembersOpen = false;
	}
	function openDialog(mode: RondoDialogMode): void {
		mobileMembersOpen = false;
		community.openDialog(mode);
	}

	function send(): void {
		if (!channel || (!draft.trim() && !files.length)) return;
		chat.send(channel.conversationId, draft, files);
		draft = '';
		files = [];
		actionError = '';
	}

	function closeMembersDialog(): void {
		mobileMembersOpen = false;
		void tick().then(() => showMembersButton?.focus());
	}
</script>

<QueryClientProvider client={queryClient}>
	<div class="flex h-[100dvh] flex-col bg-background">
		<AppHeader
			name="Rondo"
			homeHref={appPaths.portal}
			wide
			backAction={settingsOpen ? closeSettings : null}
		/>
		{#if settingsOpen}
			<DeferredRondoSettings
				preferences={voicePreferences}
				connected={voice.connected}
				onDeviceChange={voiceState.changeDevice}
				onVolumeChange={voiceState.changeVolume}
				onBack={closeSettings}
			/>
		{/if}
		<div class={settingsOpen ? 'hidden' : 'contents'}>
			<div
				class="mx-auto flex min-h-11 w-full max-w-[110rem] shrink-0 items-center gap-1 border-x border-b border-border/70 bg-card px-2 sm:px-3"
				role="group"
				aria-label="Rondo panels"
			>
				{#if !serversOpen}
					<Button
						bind:ref={showServersButton}
						variant="ghost"
						size="icon-xs"
						aria-label="Show servers"
						title="Show servers"
						onclick={toggleServers}><LayoutGridIcon class="size-4" /></Button
					>
				{/if}
				{#if !channelsVisible}
					<Button
						bind:ref={showChannelsButton}
						variant="ghost"
						size="icon-xs"
						aria-label="Show channels"
						title="Show channels"
						onclick={toggleChannels}><PanelLeftIcon class="size-4" /></Button
					>
				{/if}
				<span class="ml-2 min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground"
					>{detail?.server.name ?? 'Rondo'}{channel ? ` / #${channel.name}` : ''}</span
				>
				{#if detail && !membersVisible}
					<Button
						bind:ref={showMembersButton}
						variant="ghost"
						size="icon-xs"
						aria-label="Show members"
						title="Show members"
						onclick={toggleMembers}><PanelRightIcon class="size-4" /></Button
					>
				{/if}
				{#if !channel}
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Rondo settings"
						title="Voice & video settings"
						onclick={openSettings}><SettingsIcon class="size-4" /></Button
					>
				{/if}
			</div>
			<main
				bind:this={layoutRoot}
				id={settingsOpen ? undefined : 'main-content'}
				tabindex="-1"
				class="relative mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 overflow-hidden border-x border-border/60"
			>
				{#if serversOpen}
					<nav
						id="rondo-servers"
						aria-label="Servers"
						class="flex w-14 shrink-0 flex-col items-center gap-1.5 overflow-hidden border-r border-border/75 bg-muted/35 px-1 py-2"
					>
						<Button
							bind:ref={hideServersButton}
							variant="ghost"
							size="icon-xs"
							class="shrink-0"
							aria-label="Hide servers"
							title="Hide servers"
							onclick={toggleServers}><ChevronLeftIcon class="size-4" /></Button
						>
						<div
							class="rondo-server-scroll flex min-h-0 w-full min-w-0 flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto"
						>
							{#each servers as item (item.id)}
								<button
									type="button"
									aria-label={`Open ${item.name}`}
									aria-current={serverId === item.id ? 'page' : undefined}
									title={item.name}
									onclick={() => selectServer(item.id)}
									class={`grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold transition-[background-color,color,border-radius] focus-visible:outline-2 focus-visible:outline-ring ${serverId === item.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card text-link shadow-xs hover:bg-primary-soft'}`}
								>
									{initials(item.name)}
								</button>
							{/each}
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							class="rounded-xl"
							aria-label="Explore public servers"
							title="Explore servers"
							onclick={() => openDialog('discover')}><CompassIcon class="size-4" /></Button
						>
						<Button
							variant="outline"
							size="icon-sm"
							class="rounded-xl"
							aria-label="Create server"
							title="Create server"
							onclick={() => openDialog('create')}><PlusIcon class="size-4" /></Button
						>
					</nav>
				{/if}

				{#if channelsVisible}
					<aside
						id="rondo-channels"
						aria-label="Channels"
						class={`flex min-h-0 shrink-0 flex-col border-r border-border/75 bg-card/65 sm:w-[17rem] ${serversOpen ? 'w-[calc(100vw-3.5rem)]' : 'w-screen'}`}
					>
						<div
							class="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-3"
						>
							<span class="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
								>Channels</span
							>
							<Button
								bind:ref={hideChannelsButton}
								size="icon-xs"
								variant="ghost"
								aria-label="Hide channels"
								title="Hide channels"
								onclick={toggleChannels}><ChevronLeftIcon class="size-4" /></Button
							>
						</div>
						{#if detail}
							<div class="border-b border-border/70 px-4 py-4">
								<p class="text-[11px] font-bold tracking-[0.18em] text-link uppercase">Community</p>
								<h1 class="mt-1 truncate text-lg font-bold tracking-tight">{detail.server.name}</h1>
								<p class="mt-1 text-xs text-muted-foreground">
									{detail.server.access === 'private' ? 'Private' : 'Public'} · {detail.server
										.memberCount} members
								</p>
							</div>
							<div class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-4">
								{#if detail.server.description}<p
										class="mb-5 px-3 text-sm leading-5 text-muted-foreground"
									>
										{detail.server.description}
									</p>{/if}
								<div class="mb-2 flex items-center justify-between px-3">
									<h2
										class="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
									>
										Text &amp; voice
									</h2>
									{#if detail.server.ownerId === user.id}
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label="Create channel"
											onclick={() => openDialog('channel')}><PlusIcon class="size-4" /></Button
										>
									{/if}
								</div>
								{#each detail.channels as item (item.id)}
									<button
										type="button"
										aria-current={channelId === item.id ? 'page' : undefined}
										onclick={() => selectChannel(item.id)}
										class={`mb-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${channelId === item.id ? 'bg-primary-soft font-semibold text-primary-soft-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
									>
										<HashIcon class="size-4 shrink-0" /><span class="truncate">{item.name}</span>
										{#if voiceChannelId === item.id}<span
												class="ml-auto size-2 rounded-full bg-emerald-500"
												aria-label="Voice connected"
											></span>{/if}
									</button>
								{/each}
								{#if detail.channels.length === 0}<p
										class="px-3 py-4 text-sm text-muted-foreground"
									>
										No channels yet.
									</p>{/if}
							</div>
							{#if voiceChannelId}
								<div class="border-t border-border/70 bg-primary/5 p-3">
									<p class="truncate text-xs font-bold text-link">
										Voice · {voiceChannel?.name ?? 'Channel'}
									</p>
									<p class="mt-0.5 text-xs text-muted-foreground">
										{voice.connected ? `${voice.participants.length} connected` : 'Connecting…'}
									</p>
									<Button
										variant="outline"
										size="xs"
										class="mt-2"
										onclick={() => {
											voiceState.error = '';
											void voiceState.stop();
										}}>Disconnect</Button
									>
								</div>
							{/if}
							{#if detail.server.ownerId !== user.id}
								<div class="border-t border-border/70 p-3">
									<Button
										variant="ghost"
										size="sm"
										class="w-full"
										onclick={() => {
											community.leaveOpen = true;
										}}>Leave server</Button
									>
								</div>
							{/if}
						{:else if detailQuery.isPending && serverId}
							<div class="space-y-3 p-4" role="status" aria-label="Loading server">
								<div class="h-6 animate-pulse rounded-lg bg-muted"></div>
								<div class="h-12 animate-pulse rounded-lg bg-muted"></div>
							</div>
						{:else if detailQuery.error}
							<div class="p-4 text-sm text-destructive" role="alert">
								Could not load this server.<Button
									variant="outline"
									size="sm"
									class="mt-3"
									onclick={() => void detailQuery.refetch()}>Retry</Button
								>
							</div>
						{:else if serversQuery.error}
							<div class="p-4 text-sm text-destructive" role="alert">
								Could not load your servers.<Button
									variant="outline"
									size="sm"
									class="mt-3"
									onclick={() => void serversQuery.refetch()}>Retry</Button
								>
							</div>
						{:else}
							<div class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
								<UsersIcon class="size-10 text-link" />
								<p class="font-semibold">Your space starts here</p>
								<p class="text-sm text-muted-foreground">
									Create a server or explore public communities.
								</p>
							</div>
						{/if}
					</aside>
				{/if}

				<section
					aria-label="Channel conversation"
					class={`min-h-0 min-w-0 flex-1 flex-col ${channel || !channelsVisible ? 'flex' : 'hidden sm:flex'}`}
				>
					{#if voiceState.error}<p
							class="mx-4 mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
							role="alert"
						>
							{voiceState.error}
						</p>{/if}
					{#if voiceChannelId && voiceConnection}
						<VoiceStage
							connection={voiceConnection}
							{voice}
							channelName={voiceChannel?.name ?? 'Channel'}
							{soundsEnabled}
							onSoundsChanged={changeSounds}
							onDisconnect={() => {
								voiceState.error = '';
								void voiceState.stop();
							}}
							onError={(message) => {
								voiceState.error = message;
							}}
						/>
					{/if}
					{#if channel}
						<header
							class="grid min-h-16 shrink-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b border-border/70 bg-card/75 px-3 py-2 shadow-xs sm:flex sm:gap-3 sm:px-6 sm:py-0"
						>
							<Button
								variant="ghost"
								size="icon-sm"
								class="sm:hidden"
								aria-label="Back to channels"
								onclick={() => selectChannel(null)}><ChevronLeftIcon class="size-5" /></Button
							>
							<span
								class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"
								><HashIcon class="size-5" /></span
							>
							<div class="min-w-0 flex-1">
								<h2 class="truncate text-sm font-bold">{channel.name}</h2>
								<p class="truncate text-xs text-muted-foreground">
									{detail?.server.name} · text and voice
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Rondo settings"
								title="Voice & video settings"
								onclick={openSettings}><SettingsIcon class="size-4" /></Button
							>
							{#if voiceChannelId === channel.id}
								<span
									class="col-span-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary-soft-foreground sm:w-auto"
									><span class="size-2 rounded-full bg-emerald-500"></span>Voice connected</span
								>
							{:else}
								<Button
									size="sm"
									class="col-span-4 w-full sm:w-auto"
									disabled={voiceBusy}
									onclick={() => void voiceState.start(channel)}
									><MicIcon class="size-4" />
									{voiceBusy
										? 'Connecting…'
										: voiceChannelId
											? 'Switch voice'
											: 'Join voice'}</Button
								>
							{/if}
						</header>
						{#if liveUnavailable}
							<div
								class="flex shrink-0 items-center gap-3 border-b border-border bg-muted/35 px-4 py-2"
							>
								<p class="min-w-0 flex-1 text-xs leading-5 text-muted-foreground" role="status">
									Messages refresh automatically while live updates are paused.
								</p>
								<Button
									variant="outline"
									size="xs"
									onclick={chat.connect}
									aria-label="Reconnect live updates">Reconnect</Button
								>
							</div>
						{/if}
						{#if actionError}<p
								class="mx-4 mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
								role="alert"
							>
								{actionError}
							</p>{/if}
						{#if messagesQuery.error}
							<div
								class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
								role="alert"
							>
								Could not load messages.<Button
									variant="outline"
									size="xs"
									class="ml-2"
									onclick={() => void messagesQuery.refetch()}>Retry</Button
								>
							</div>
						{:else if messageViewError}
							<div
								class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
								role="alert"
							>
								Could not load the message view.<Button
									variant="outline"
									size="xs"
									class="ml-2"
									onclick={() => {
										messageViewError = false;
									}}>Retry</Button
								>
							</div>
						{:else if messagesQuery.isPending || !LoadedMessageList}
							<div
								class="flex flex-1 flex-col justify-end gap-3 p-6"
								role="status"
								aria-label="Loading messages"
							>
								<div class="h-14 w-1/2 animate-pulse rounded-2xl bg-muted"></div>
								<div class="ml-auto h-20 w-2/3 animate-pulse rounded-2xl bg-muted"></div>
							</div>
						{:else}
							{#key channel.conversationId}
								<LoadedMessageList
									{messages}
									pending={activePending}
									viewerId={user.id}
									personal={false}
									group={true}
									showReceipt={false}
									hasMore={!!messagesQuery.hasNextPage}
									loadingMore={messagesQuery.isFetchingNextPage}
									loadOlder={async () => {
										await messagesQuery.fetchNextPage();
									}}
									retry={chat.retry}
									react={chat.react}
									edit={chat.edit}
									remove={chat.remove}
								/>
							{/key}
						{/if}
						<MessageComposer
							bind:draft
							bind:files
							bind:actionError
							maxAttachments={maxMessageFiles}
							maxCharacters={4000}
							placeholder={`Message #${channel.name}`}
							showHint={false}
							onSend={send}
						/>
					{:else}
						<div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
							<span class="grid size-20 place-items-center rounded-[1.75rem] bg-accent"
								><HashIcon class="size-10 text-accent-foreground" /></span
							>
							<h2 class="mt-6 text-2xl font-bold tracking-tight">Choose a channel</h2>
							<p class="mt-2 max-w-sm text-sm text-muted-foreground">
								Share messages, files and a voice room with your community.
							</p>
						</div>
					{/if}
				</section>
				{#if detail && membersVisible && wideMembers}
					<aside
						aria-label="Server members"
						class="flex min-h-0 w-60 shrink-0 flex-col border-l border-border/75 bg-card"
					>
						<MemberPanel
							current={detail}
							userId={user.id}
							onInvite={() => openDialog('invite')}
							onHide={toggleMembers}
							bind:hideButton={hideMembersButton}
						/>
					</aside>
				{/if}
			</main>
		</div>
	</div>

	<Dialog.Root
		open={!!detail && !wideMembers && membersVisible}
		onOpenChange={(open) => {
			if (!open) closeMembersDialog();
		}}
	>
		<Dialog.Content class="rondo-members-sheet" showCloseButton={false}>
			<Dialog.Header class="sr-only"
				><Dialog.Title>Server members</Dialog.Title><Dialog.Description
					>People in this server.</Dialog.Description
				></Dialog.Header
			>
			{#if detail}
				<MemberPanel
					current={detail}
					userId={user.id}
					onInvite={() => openDialog('invite')}
					onHide={toggleMembers}
					bind:hideButton={hideMembersButton}
				/>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<RondoCommunityDialogs state={community} />
</QueryClientProvider>

<style>
	.rondo-server-scroll {
		scrollbar-width: none;
	}
	.rondo-server-scroll::-webkit-scrollbar {
		display: none;
	}
	:global(.rondo-members-sheet) {
		top: 0;
		right: 0;
		left: auto;
		display: flex;
		width: min(20rem, 100vw);
		max-width: 100vw;
		height: 100dvh;
		max-height: 100dvh;
		gap: 0;
		padding: 0;
		border-radius: 0;
		transform: none;
	}
</style>
