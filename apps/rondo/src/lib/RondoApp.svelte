<script lang="ts">
  // Coordinates Rondo server navigation, chat activity, and voice sessions

  import { onDestroy, onMount, tick } from 'svelte';
  import { createInfiniteQuery, createQuery, QueryClient, type InfiniteData } from '@tanstack/svelte-query';
  import {
    appendSentMessage, replaceCachedMessage, createLigoApi, createRondoApi, ligoMessageOptions, ligoUserSearchOptions,
    rondoDiscoverOptions, rondoServerOptions, rondoServersOptions
  } from '@kaordo/api-client';
  import type {
    LigoMessage, LigoMessagePage, LigoReaction, RondoChannel,
    RondoServer, UserIdentity
  } from '@kaordo/contracts';
  import type { PendingMessage } from '@kaordo/chat-ui';
  import MessageComposer from '@kaordo/chat-ui/message-composer';
  import type MessageListComponent from '@kaordo/chat-ui/message-list';
  import { uploadMedia } from '@kaordo/media-client';
  import { appPaths } from '@kaordo/links';
  import type { VoiceConnection, VoiceSnapshot } from '@kaordo/voice-client';
  import { VoiceSounds } from '@kaordo/voice-client/sounds';
  import {
    formatRondoRoute, getInitials as initials, parseLayoutPreferences,
    parseRondoRoute
  } from './rondo-state';
  import {
    AlertDialog, AppHeader, Button, ChevronLeftIcon, CompassIcon, Dialog, HashIcon,
    Input, LayoutGridIcon, MicIcon, PanelLeftIcon, PanelRightIcon,
    PlusIcon, SearchIcon, Textarea, UsersIcon, UserPlusIcon
  } from '@kaordo/ui';
  import MemberPanel from './MemberPanel.svelte';
  import VoiceStage from './VoiceStage.svelte';

  type DialogMode = 'create' | 'discover' | 'channel' | 'invite';

  const maxMessageFiles = 8;
  const dialogCopy: Record<DialogMode, { title: string; description: string }> = {
    create: {
      title: 'Create a server',
      description: 'Start with a general channel and invite people when you are ready.'
    },
    discover: {
      title: 'Explore servers',
      description: 'Join a public community.'
    },
    channel: {
      title: 'Create a channel',
      description: 'Every channel has messages and its own voice room.'
    },
    invite: {
      title: 'Invite a member',
      description: 'Find a Kaordo account by username.'
    }
  };

  let { user }: { user: UserIdentity } = $props();
  const rondo = createRondoApi(import.meta.env.VITE_KAORDO_API_URL);
  const ligo = createLigoApi(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL);
  const queryClient = new QueryClient();
  const serversQuery = createQuery(() => rondoServersOptions(rondo), () => queryClient);
  let serverId = $state<string | null>(null);
  let channelId = $state<string | null>(null);
  let dialog = $state<DialogMode | null>(null);
  let dialogContentMode = $state<DialogMode>('create');
  let dialogBusy = $state(false);
  let dialogError = $state('');
  let actionError = $state('');
  let serverName = $state('');
  let serverDescription = $state('');
  let serverAccess = $state<'public' | 'private'>('private');
  let channelName = $state('');
  let discoverInput = $state('');
  let discoverTerm = $state('');
  let inviteInput = $state('');
  let inviteTerm = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let draft = $state('');
  let files = $state<File[]>([]);
  let pending = $state<PendingMessage[]>([]);
  let LoadedMessageList = $state<typeof MessageListComponent | null>(null);
  let messageViewError = $state(false);
  let voiceConnection = $state<VoiceConnection | null>(null);
  let voiceGeneration = 0;
  let voiceChannelId = $state<string | null>(null);
  let voiceBusy = $state(false);
  let voiceError = $state('');
  const emptyVoice = (): VoiceSnapshot => ({ connected: false, reconnecting: false, microphoneEnabled: false,
    cameraEnabled: false, screenShareEnabled: false, deafened: false, canPlaybackAudio: true,
    canPlaybackVideo: true, participants: [], videos: [] });
  let voice = $state<VoiceSnapshot>(emptyVoice());
  let soundsEnabled = $state(true);
  let serversOpen = $state(true);
  let channelsOpen = $state(true);
  let membersOpen = $state<boolean | null>(null);
  let mobileMembersOpen = $state(false);
  let wideMembers = $state(false);
  let narrowChannels = $state(false);
  let leaveOpen = $state(false);
  let showServersButton = $state<HTMLButtonElement | null>(null);
  let hideServersButton = $state<HTMLButtonElement | null>(null);
  let showChannelsButton = $state<HTMLButtonElement | null>(null);
  let hideChannelsButton = $state<HTMLButtonElement | null>(null);
  let showMembersButton = $state<HTMLButtonElement | null>(null);
  let hideMembersButton = $state<HTMLButtonElement | null>(null);

  const detailQuery = createQuery(() => rondoServerOptions(rondo, serverId), () => queryClient);
  const discoverQuery = createQuery(() => rondoDiscoverOptions(rondo, discoverTerm, dialog === 'discover'), () => queryClient);
  const inviteQuery = createQuery(() => ligoUserSearchOptions(ligo, inviteTerm, dialog === 'invite'), () => queryClient);
  const servers = $derived(serversQuery.data?.items ?? []);
  const detail = $derived(detailQuery.data ?? null);
  const inviteCandidates = $derived((inviteQuery.data?.items ?? []).filter((candidate) =>
    !detail?.members.some((member) => member.id === candidate.id)));
  const channel = $derived(detail?.channels.find((item) => item.id === channelId) ?? null);
  const voiceChannel = $derived(detail?.channels.find((item) => item.id === voiceChannelId) ?? null);
  const membersVisible = $derived(wideMembers ? (membersOpen ?? true) : mobileMembersOpen);
  const channelsVisible = $derived(channelsOpen && (!narrowChannels || !channelId));
  const messagesQuery = createInfiniteQuery(() => ({
    ...ligoMessageOptions(ligo, channel?.conversationId ?? ''), enabled: !!channel
  }), () => queryClient);
  const messages = $derived(messagesQuery.data?.pages.flatMap((page) => page.items).reverse() ?? []);
  const activePending = $derived(pending.filter((item) => item.conversationId === channel?.conversationId &&
    !messages.some((message) => message.clientId === item.clientId)));

  $effect(() => {
    if (!serverId && servers.length) selectServer(servers[0].id);
  });
  $effect(() => {
    if (!channel || LoadedMessageList || messageViewError) return;
    void import('@kaordo/chat-ui/message-list').then(({ default: MessageList }) => {
      LoadedMessageList = MessageList;
    })
      .catch(() => { messageViewError = true; });
  });

  onMount(() => {
    const removeBreakpointListeners = watchBreakpoints();
    restorePreferences();
    const removeRouteListener = watchRouteHash();
    const stopLiveUpdates = subscribeToMessageUpdates();

    return () => {
      removeBreakpointListeners();
      removeRouteListener();
      stopLiveUpdates();
    };
  });
  onDestroy(() => {
    queryClient.clear();
    if (searchTimer) clearTimeout(searchTimer);
    void stopVoice();
  });

  function watchBreakpoints(): () => void {
    const memberBreakpoint = window.matchMedia('(min-width: 1280px)');
    const channelBreakpoint = window.matchMedia('(max-width: 639px)');
    const updateMembers = () => {
      wideMembers = memberBreakpoint.matches;
      mobileMembersOpen = false;
    };
    const updateChannels = () => {
      narrowChannels = channelBreakpoint.matches;
    };

    updateMembers();
    updateChannels();
    memberBreakpoint.addEventListener('change', updateMembers);
    channelBreakpoint.addEventListener('change', updateChannels);

    return () => {
      memberBreakpoint.removeEventListener('change', updateMembers);
      channelBreakpoint.removeEventListener('change', updateChannels);
    };
  }

  function restorePreferences(): void {
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
      const route = parseRondoRoute(window.location.hash);
      if (!route) return;
      serverId = route.serverId;
      channelId = route.channelId;
    };

    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }

  function subscribeToMessageUpdates(): () => void {
    const controller = new AbortController();
    void ligo.subscribe(controller.signal, (conversationId) => {
      if (!conversationId || conversationId === channel?.conversationId) {
        void queryClient.invalidateQueries({ queryKey: ['ligo', 'messages', channel?.conversationId] });
      }
    }).catch(() => {
      // Polling remains available when live updates disconnect.
    });

    return () => controller.abort();
  }

  function saveLayout() {
    try {
      localStorage.setItem('kaordo-rondo-layout', JSON.stringify({
        servers: serversOpen, channels: channelsOpen, members: membersOpen
      }));
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
    localStorage.setItem('kaordo-rondo-sounds', enabled ? 'on' : 'off');
    voiceConnection?.setSoundEnabled(enabled);
  }
  function selectServer(id: string) {
    if (serverId !== id && (voiceConnection || voiceBusy)) void stopVoice();
    serverId = id;
    channelId = null;
    window.location.hash = formatRondoRoute(id, null);
    actionError = '';
    voiceError = '';
    mobileMembersOpen = false;
  }
  function selectChannel(id: string | null) {
    channelId = id;
    if (serverId) window.location.hash = formatRondoRoute(serverId, id);
    draft = '';
    files = [];
    actionError = '';
    mobileMembersOpen = false;
  }
  function openDialog(mode: DialogMode | null) {
    mobileMembersOpen = false;
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
      const created = await rondo.create(input);
      queryClient.setQueryData(['rondo', 'server', created.server.id], created);
      await queryClient.invalidateQueries({ queryKey: ['rondo', 'servers'] });
      dialog = null;
      serverName = '';
      serverDescription = '';
      selectServer(created.server.id);
      selectChannel(created.channels[0]?.id ?? null);
    });
  }

  async function joinServer(item: RondoServer) {
    await runDialogAction(async () => {
      const joined = await rondo.join(item.id);
      queryClient.setQueryData(['rondo', 'server', item.id], joined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rondo', 'servers'] }),
        queryClient.invalidateQueries({ queryKey: ['rondo', 'discover'] })
      ]);
      dialog = null;
      selectServer(item.id);
      selectChannel(joined.channels[0]?.id ?? null);
    });
  }

  async function createChannel() {
    const selectedServerId = serverId;
    const name = channelName.trim();
    if (!selectedServerId || !name) return;

    await runDialogAction(async () => {
      const created = await rondo.createChannel(selectedServerId, name);
      await queryClient.invalidateQueries({ queryKey: ['rondo', 'server', selectedServerId] });
      dialog = null;
      channelName = '';
      selectChannel(created.id);
    });
  }

  async function invite(userId: string) {
    const selectedServerId = serverId;
    if (!selectedServerId) return;

    await runDialogAction(async () => {
      const updated = await rondo.invite(selectedServerId, userId);
      queryClient.setQueryData(['rondo', 'server', selectedServerId], updated);
      dialog = null;
    });
  }

  async function runDialogAction(action: () => Promise<void>): Promise<void> {
    if (dialogBusy) return;

    dialogBusy = true;
    dialogError = '';
    try {
      await action();
    } catch (error) {
      dialogError = errorMessage(error);
    } finally {
      dialogBusy = false;
    }
  }

  async function leaveServer() {
    const serverToLeave = serverId;
    if (!serverToLeave || dialogBusy) return;

    dialogBusy = true;
    try {
      if (voiceChannelId && detail?.server.id === serverToLeave) await stopVoice();
      await rondo.leave(serverToLeave);
      queryClient.removeQueries({ queryKey: ['rondo', 'server', serverToLeave] });
      await queryClient.invalidateQueries({ queryKey: ['rondo', 'servers'] });
      serverId = null;
      channelId = null;
      window.location.hash = '';
      leaveOpen = false;
    } catch (error) {
      actionError = errorMessage(error);
    } finally {
      dialogBusy = false;
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Please try again.';
  }
  function updatePending(item: PendingMessage, changes: Partial<PendingMessage>) {
    Object.assign(item, changes);
    pending = pending.map((entry) => {
      return entry.clientId === item.clientId ? { ...item } : entry;
    });
  }

  async function uploadPendingAttachments(item: PendingMessage): Promise<void> {
    if (item.attachmentIds || !item.files.length) return;

    item.attachmentIds = await uploadMedia(
      item.files,
      import.meta.env.VITE_KAORDO_NODO_URL,
      ligo,
      (progress) => updatePending(item, { progress }),
      { allowFiles: true, maxFiles: maxMessageFiles }
    );
  }

  function cacheSentMessage(message: LigoMessage): void {
    queryClient.setQueryData<InfiniteData<LigoMessagePage>>(
      ['ligo', 'messages', message.conversationId],
      (existing) => appendSentMessage(existing, message)
    );
  }

  async function deliver(item: PendingMessage) {
    const initialStatus = item.files.length && !item.attachmentIds ? 'uploading' : 'sending';
    updatePending(item, { status: initialStatus, error: undefined });
    try {
      await uploadPendingAttachments(item);
      updatePending(item, { status: 'sending' });
      const sent = await ligo.send(item.conversationId, {
        clientId: item.clientId, text: item.text, attachmentIds: item.attachmentIds ?? []
      });
      cacheSentMessage(sent);
      pending = pending.filter((entry) => entry.clientId !== item.clientId);
    } catch (error) {
      updatePending(item, { status: 'failed', error: errorMessage(error) });
    }
  }
  function send() {
    if (!channel || (!draft.trim() && !files.length)) return;
    const item: PendingMessage = {
      clientId: crypto.randomUUID(),
      conversationId: channel.conversationId,
      text: draft.trim(),
      files: [...files],
      progress: 0,
      status: files.length ? 'uploading' : 'sending',
      createdAt: new Date().toISOString()
    };
    pending = [...pending, item];
    draft = '';
    files = [];
    actionError = '';
    void deliver(item);
  }

  function replaceMessage(message: LigoMessage) {
    queryClient.setQueryData<InfiniteData<LigoMessagePage>>(
      ['ligo', 'messages', message.conversationId],
      (existing) => replaceCachedMessage(existing, message)
    );
  }
  async function react(message: LigoMessage, emoji: LigoReaction['emoji']) {
    const current = message.reactions.find((item) => item.emoji === emoji);
    replaceMessage(await ligo.setReaction(message.conversationId, message.id, emoji, !current?.mine));
  }
  async function edit(message: LigoMessage, text: string) {
    replaceMessage(await ligo.editMessage(message.conversationId, message.id, text));
  }
  async function remove(message: LigoMessage) {
    await ligo.deleteMessage(message.conversationId, message.id);
    await queryClient.invalidateQueries({ queryKey: ['ligo', 'messages', message.conversationId] });
  }

  function isVoiceAttemptCurrent(generation: number, target: RondoChannel): boolean {
    return generation === voiceGeneration && target.serverId === serverId;
  }

  function subscribeToVoiceConnection(connection: VoiceConnection): void {
    let connectedBefore = false;
    connection.subscribe((state) => {
      const disconnectedUnexpectedly = connectedBefore && !state.connected && !state.reconnecting &&
        voiceConnection === connection;
      if (disconnectedUnexpectedly) {
        voiceError = 'Voice disconnected. Join again to reconnect.';
        void stopVoice();
        return;
      }

      voice = state;
      if (state.connected) connectedBefore = true;
    });
  }

  async function startVoice(target: RondoChannel) {
    if (voiceBusy) return;
    voiceBusy = true;
    voiceError = '';
    const disconnecting = stopVoice(true);
    const generation = voiceGeneration;
    const sounds = new VoiceSounds();
    sounds.enabled = soundsEnabled;
    sounds.unlock();
    let connectedToSounds = false;
    try {
      await disconnecting;
      if (!isVoiceAttemptCurrent(generation, target)) return;

      const ticket = await rondo.voiceToken(target.id);
      if (!isVoiceAttemptCurrent(generation, target)) return;

      const { VoiceConnection } = await import('@kaordo/voice-client');
      if (!isVoiceAttemptCurrent(generation, target)) return;

      const connection = new VoiceConnection(sounds);
      connectedToSounds = true;
      connection.setSoundEnabled(soundsEnabled);
      voiceConnection = connection;
      voiceChannelId = target.id;
      subscribeToVoiceConnection(connection);
      await connection.connect(ticket.serverUrl, ticket.participantToken);
      if (!isVoiceAttemptCurrent(generation, target)) await connection.disconnect();
    } catch (error) {
      if (generation === voiceGeneration) {
        voiceError = errorMessage(error);
        await stopVoice();
      }
    } finally {
      if (!connectedToSounds) sounds.dispose();
      if (generation === voiceGeneration) voiceBusy = false;
    }
  }
  async function stopVoice(preserveBusy = false) {
    voiceGeneration++;
    const connection = voiceConnection;
    voiceConnection = null;
    voiceChannelId = null;
    if (!preserveBusy) voiceBusy = false;
    voice = emptyVoice();
    await connection?.disconnect();
  }

  function closeMembersDialog(): void {
    mobileMembersOpen = false;
    void tick().then(() => showMembersButton?.focus());
  }

  function handleDialogOpenChange(open: boolean): void {
    if (!open && !dialogBusy) dialog = null;
  }
</script>

<div class="flex h-[100dvh] flex-col bg-background">
  <AppHeader name="Rondo" homeHref={appPaths.portal} wide />
  <div class="mx-auto flex h-11 w-full max-w-[110rem] shrink-0 items-center gap-1 border-x border-b border-border/70 bg-card px-2 sm:px-3" role="toolbar" aria-label="Rondo panels">
    {#if !serversOpen}
      <Button bind:ref={showServersButton} variant="ghost" size="icon-xs" aria-label="Show servers" title="Show servers" onclick={toggleServers}><LayoutGridIcon class="size-4" /></Button>
    {/if}
    {#if !channelsVisible}
      <Button bind:ref={showChannelsButton} variant="ghost" size="icon-xs" aria-label="Show channels" title="Show channels" onclick={toggleChannels}><PanelLeftIcon class="size-4" /></Button>
    {/if}
    <span class="ml-2 min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">{detail?.server.name ?? 'Rondo'}{channel ? ` / #${channel.name}` : ''}</span>
    {#if detail && !membersVisible}
      <Button bind:ref={showMembersButton} variant="ghost" size="icon-xs" aria-label="Show members" title="Show members" onclick={toggleMembers}><PanelRightIcon class="size-4" /></Button>
    {/if}
  </div>
  <main id="main-content" tabindex="-1" class="relative mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 overflow-hidden border-x border-border/60">
    {#if serversOpen}
      <nav id="rondo-servers" aria-label="Servers" class="flex w-14 shrink-0 flex-col items-center gap-1.5 overflow-hidden border-r border-border/75 bg-muted/35 px-1 py-2">
        <Button bind:ref={hideServersButton} variant="ghost" size="icon-xs" class="shrink-0" aria-label="Hide servers" title="Hide servers" onclick={toggleServers}><ChevronLeftIcon class="size-4" /></Button>
        <div class="rondo-server-scroll flex min-h-0 min-w-0 w-full flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto">
          {#each servers as item (item.id)}
            <button type="button" aria-label={`Open ${item.name}`} aria-current={serverId === item.id ? 'page' : undefined}
              title={item.name} onclick={() => selectServer(item.id)}
              class={`grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold transition-[background-color,color,border-radius] focus-visible:outline-2 focus-visible:outline-ring ${serverId === item.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card text-link shadow-xs hover:bg-primary-soft'}`}>
              {initials(item.name)}
            </button>
          {/each}
        </div>
        <Button variant="ghost" size="icon-sm" class="rounded-xl" aria-label="Explore public servers" title="Explore servers" onclick={() => openDialog('discover')}><CompassIcon class="size-4" /></Button>
        <Button variant="outline" size="icon-sm" class="rounded-xl" aria-label="Create server" title="Create server" onclick={() => openDialog('create')}><PlusIcon class="size-4" /></Button>
      </nav>
    {/if}

    {#if channelsVisible}
    <aside id="rondo-channels" aria-label="Channels" class={`flex min-h-0 shrink-0 flex-col border-r border-border/75 bg-card/65 sm:w-[17rem] ${serversOpen ? 'w-[calc(100vw-3.5rem)]' : 'w-screen'}`}>
      <div class="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-3">
        <span class="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Channels</span>
        <Button bind:ref={hideChannelsButton} size="icon-xs" variant="ghost" aria-label="Hide channels" title="Hide channels" onclick={toggleChannels}><ChevronLeftIcon class="size-4" /></Button>
      </div>
      {#if detail}
        <div class="border-b border-border/70 px-4 py-4">
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-link">Community</p>
          <h1 class="mt-1 truncate text-lg font-bold tracking-tight">{detail.server.name}</h1>
          <p class="mt-1 text-xs text-muted-foreground">{detail.server.access === 'private' ? 'Private' : 'Public'} · {detail.server.memberCount} members</p>
        </div>
        <div class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-4">
          {#if detail.server.description}<p class="mb-5 px-3 text-sm leading-5 text-muted-foreground">{detail.server.description}</p>{/if}
          <div class="mb-2 flex items-center justify-between px-3">
            <h2 class="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Text &amp; voice</h2>
            {#if detail.server.ownerId === user.id}
              <Button size="icon-xs" variant="ghost" aria-label="Create channel" onclick={() => openDialog('channel')}><PlusIcon class="size-4" /></Button>
            {/if}
          </div>
          {#each detail.channels as item (item.id)}
            <button type="button" aria-current={channelId === item.id ? 'page' : undefined}
              onclick={() => selectChannel(item.id)}
              class={`mb-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${channelId === item.id ? 'bg-primary-soft font-semibold text-primary-soft-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <HashIcon class="size-4 shrink-0" /><span class="truncate">{item.name}</span>
              {#if voiceChannelId === item.id}<span class="ml-auto size-2 rounded-full bg-emerald-500" aria-label="Voice connected"></span>{/if}
            </button>
          {/each}
          {#if detail.channels.length === 0}<p class="px-3 py-4 text-sm text-muted-foreground">No channels yet.</p>{/if}
        </div>
        {#if voiceChannelId}
          <div class="border-t border-border/70 bg-primary/5 p-3">
            <p class="truncate text-xs font-bold text-link">Voice · {voiceChannel?.name ?? 'Channel'}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">{voice.connected ? `${voice.participants.length} connected` : 'Connecting…'}</p>
            <Button variant="outline" size="xs" class="mt-2" onclick={() => { voiceError = ''; void stopVoice(); }}>Disconnect</Button>
          </div>
        {/if}
        {#if detail.server.ownerId !== user.id}
          <div class="border-t border-border/70 p-3"><Button variant="ghost" size="sm" class="w-full" onclick={() => { leaveOpen = true; }}>Leave server</Button></div>
        {/if}
      {:else if detailQuery.isPending && serverId}
        <div class="space-y-3 p-4" role="status" aria-label="Loading server"><div class="h-6 animate-pulse rounded-lg bg-muted"></div><div class="h-12 animate-pulse rounded-lg bg-muted"></div></div>
      {:else if detailQuery.error}
        <div class="p-4 text-sm text-destructive" role="alert">Could not load this server.<Button variant="outline" size="sm" class="mt-3" onclick={() => void detailQuery.refetch()}>Retry</Button></div>
      {:else if serversQuery.error}
        <div class="p-4 text-sm text-destructive" role="alert">Could not load your servers.<Button variant="outline" size="sm" class="mt-3" onclick={() => void serversQuery.refetch()}>Retry</Button></div>
      {:else}
        <div class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center"><UsersIcon class="size-10 text-link" /><p class="font-semibold">Your space starts here</p><p class="text-sm text-muted-foreground">Create a server or explore public communities.</p></div>
      {/if}
    </aside>
    {/if}

    <section aria-label="Channel conversation" class={`min-h-0 min-w-0 flex-1 flex-col ${channel || !channelsVisible ? 'flex' : 'hidden sm:flex'}`}>
      {#if voiceError}<p class="mx-4 mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{voiceError}</p>{/if}
      {#if voiceChannelId && voiceConnection}
        <VoiceStage connection={voiceConnection} {voice} channelName={voiceChannel?.name ?? 'Channel'} {soundsEnabled}
          onSoundsChanged={changeSounds} onDisconnect={() => { voiceError = ''; void stopVoice(); }} onError={(message) => { voiceError = message; }} />
      {/if}
      {#if channel}
        <header class="grid min-h-16 shrink-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 border-b border-border/70 bg-card/75 px-3 py-2 shadow-xs sm:flex sm:gap-3 sm:px-6 sm:py-0">
          <Button variant="ghost" size="icon-sm" class="sm:hidden" aria-label="Back to channels" onclick={() => selectChannel(null)}><ChevronLeftIcon class="size-5" /></Button>
          <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"><HashIcon class="size-5" /></span>
          <div class="min-w-0 flex-1"><h2 class="truncate text-sm font-bold">{channel.name}</h2><p class="truncate text-xs text-muted-foreground">{detail?.server.name} · text and voice</p></div>
          {#if voiceChannelId === channel.id}
            <span class="col-span-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary-soft-foreground sm:w-auto"><span class="size-2 rounded-full bg-emerald-500"></span>Voice connected</span>
          {:else}
            <Button size="sm" class="col-span-3 w-full sm:w-auto" disabled={voiceBusy} onclick={() => void startVoice(channel)}><MicIcon class="size-4" /> {voiceBusy ? 'Connecting…' : voiceChannelId ? 'Switch voice' : 'Join voice'}</Button>
          {/if}
        </header>
        {#if actionError}<p class="mx-4 mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{actionError}</p>{/if}
        {#if messagesQuery.error}
          <div class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">Could not load messages.<Button variant="outline" size="xs" class="ml-2" onclick={() => void messagesQuery.refetch()}>Retry</Button></div>
        {:else if messageViewError}
          <div class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">Could not load the message view.<Button variant="outline" size="xs" class="ml-2" onclick={() => { messageViewError = false; }}>Retry</Button></div>
        {:else if messagesQuery.isPending || !LoadedMessageList}
          <div class="flex flex-1 flex-col justify-end gap-3 p-6" role="status" aria-label="Loading messages"><div class="h-14 w-1/2 animate-pulse rounded-2xl bg-muted"></div><div class="ml-auto h-20 w-2/3 animate-pulse rounded-2xl bg-muted"></div></div>
        {:else}
          {#key channel.conversationId}
            <LoadedMessageList {messages} pending={activePending} viewerId={user.id} personal={false} group={true} showReceipt={false}
              hasMore={!!messagesQuery.hasNextPage} loadingMore={messagesQuery.isFetchingNextPage}
              loadOlder={async () => { await messagesQuery.fetchNextPage(); }} retry={(item) => { void deliver(item); }} {react} {edit} {remove} />
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
        <div class="flex flex-1 flex-col items-center justify-center px-6 text-center"><span class="grid size-20 place-items-center rounded-[1.75rem] bg-accent"><HashIcon class="size-10 text-accent-foreground" /></span><h2 class="mt-6 text-2xl font-bold tracking-tight">Choose a channel</h2><p class="mt-2 max-w-sm text-sm text-muted-foreground">Share messages, files and a voice room with your community.</p></div>
      {/if}
    </section>
    {#if detail && membersVisible && wideMembers}
      <aside aria-label="Server members" class="flex min-h-0 w-60 shrink-0 flex-col border-l border-border/75 bg-card">
        <MemberPanel current={detail} userId={user.id} onInvite={() => openDialog('invite')}
          onHide={toggleMembers} bind:hideButton={hideMembersButton} />
      </aside>
    {/if}
  </main>
</div>

<Dialog.Root open={!!detail && !wideMembers && membersVisible} onOpenChange={(open) => { if (!open) closeMembersDialog(); }}>
  <Dialog.Content class="rondo-members-sheet" showCloseButton={false}>
    <Dialog.Header class="sr-only"><Dialog.Title>Server members</Dialog.Title><Dialog.Description>People in this server.</Dialog.Description></Dialog.Header>
    {#if detail}
      <MemberPanel current={detail} userId={user.id} onInvite={() => openDialog('invite')}
        onHide={toggleMembers} bind:hideButton={hideMembersButton} />
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!dialog} onOpenChange={handleDialogOpenChange}>
  <Dialog.Content class="max-h-[90dvh] overflow-hidden p-2 sm:max-w-lg">
    <div class="kaordo-scrollbar max-h-[calc(90dvh-1rem)] space-y-4 overflow-y-auto p-3 sm:p-5">
      <Dialog.Header class="pr-8"><Dialog.Title class="text-xl font-bold">{dialogCopy[dialogContentMode].title}</Dialog.Title>
        <Dialog.Description>{dialogCopy[dialogContentMode].description}</Dialog.Description></Dialog.Header>
      {#if dialogContentMode === 'create'}
        <label class="block text-sm font-semibold" for="rondo-name">Server name</label>
        <Input id="rondo-name" bind:value={serverName} maxlength={100} placeholder="Your community" />
        <label class="block text-sm font-semibold" for="rondo-description">Description</label>
        <Textarea id="rondo-description" bind:value={serverDescription} maxlength={500} rows={3} placeholder="What brings people together?" />
        <fieldset class="space-y-2"><legend class="text-sm font-semibold">Access</legend>
          <label class="flex items-center gap-2 text-sm"><input type="radio" bind:group={serverAccess} value="private" class="accent-primary" /> Private · owner invites members</label>
          <label class="flex items-center gap-2 text-sm"><input type="radio" bind:group={serverAccess} value="public" class="accent-primary" /> Public · anyone can join</label>
        </fieldset>
        <Dialog.Footer><Button disabled={dialogBusy || !serverName.trim()} onclick={() => void createServer()}>{dialogBusy ? 'Creating…' : 'Create server'}</Button></Dialog.Footer>
      {:else if dialogContentMode === 'discover'}
        <label class="relative block"><SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search public servers" placeholder="Search public servers" class="pl-10" value={discoverInput} oninput={(event) => search(event.currentTarget.value, 'discover')} /></label>
        {#if discoverQuery.isPending}<p class="py-5 text-center text-sm text-muted-foreground" role="status">Loading communities…</p>
        {:else if discoverQuery.error}<p class="text-sm text-destructive" role="alert">Could not load public servers.</p>
        {:else if !discoverQuery.data?.items.length}<p class="py-5 text-center text-sm text-muted-foreground">No public servers found.</p>
        {:else}<div class="space-y-2">{#each discoverQuery.data.items as item (item.id)}
          <div class="flex items-center gap-3 rounded-xl border border-border p-3"><span class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft font-bold text-primary-soft-foreground">{initials(item.name)}</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-bold">{item.name}</p><p class="truncate text-xs text-muted-foreground">{item.memberCount} members · {item.description || 'Public community'}</p></div><Button size="sm" disabled={dialogBusy} onclick={() => void joinServer(item)}>Join</Button></div>
        {/each}</div>{/if}
      {:else if dialogContentMode === 'channel'}
        <label class="block text-sm font-semibold" for="rondo-channel">Channel name</label><Input id="rondo-channel" bind:value={channelName} maxlength={80} placeholder="ideas" />
        <Dialog.Footer><Button disabled={dialogBusy || !channelName.trim()} onclick={() => void createChannel()}>{dialogBusy ? 'Creating…' : 'Create channel'}</Button></Dialog.Footer>
      {:else if dialogContentMode === 'invite'}
        <label class="block text-sm font-semibold" for="rondo-invite">Find an account</label><Input id="rondo-invite" placeholder="Search by username" value={inviteInput} oninput={(event) => search(event.currentTarget.value, 'invite')} />
        {#if inviteTerm.length < 2}<p class="text-sm text-muted-foreground">Type at least two characters.</p>
        {:else if inviteQuery.isPending}<p class="text-sm text-muted-foreground" role="status">Searching accounts…</p>
        {:else if inviteQuery.error}<p class="text-sm text-destructive" role="alert">Search is unavailable.</p>
        {:else if !inviteCandidates.length}<p class="text-sm text-muted-foreground">{inviteQuery.data?.items.length ? 'Everyone matching is already in this server.' : 'No accounts found.'}</p>
        {:else}<div class="space-y-1">{#each inviteCandidates as candidate (candidate.id)}
          <button type="button" disabled={dialogBusy} onclick={() => void invite(candidate.id)} class="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><span class="grid size-9 place-items-center rounded-xl bg-primary-soft text-xs font-bold text-primary-soft-foreground">{initials(candidate.displayName)}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">{candidate.displayName}</span><span class="block truncate text-xs text-muted-foreground">@{candidate.username}</span></span><UserPlusIcon class="size-4 text-link" /></button>
        {/each}</div>{/if}
      {/if}
      {#if dialogError}<p class="rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{dialogError}</p>{/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={leaveOpen}>
  <AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>Leave this server?</AlertDialog.Title><AlertDialog.Description>You will lose access to its channels and voice rooms. The owner can invite you again.</AlertDialog.Description></AlertDialog.Header>
    <AlertDialog.Footer><AlertDialog.Cancel disabled={dialogBusy}>Cancel</AlertDialog.Cancel><Button variant="destructive" disabled={dialogBusy} onclick={() => void leaveServer()}>Leave server</Button></AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .rondo-server-scroll { scrollbar-width: none; }
  .rondo-server-scroll::-webkit-scrollbar { display: none; }
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
