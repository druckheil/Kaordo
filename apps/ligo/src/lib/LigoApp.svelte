<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { createInfiniteQuery, createQuery, QueryClient, type InfiniteData } from '@tanstack/svelte-query';
  import { createLigoApi, ligoConversationOptions, ligoConversationDetailOptions, ligoMessageOptions, ligoUserSearchOptions } from '@kaordo/api-client';
  import type {
    LigoConversation, LigoMessage, LigoMessagePage, LigoReaction, LigoUser, UserIdentity
  } from '@kaordo/contracts';
  import { uploadMedia } from '@kaordo/media-client';
  import { appPaths } from '@kaordo/links';
  import {
    ArrowUpRightIcon, BookmarkIcon, Button, CheckIcon, ChevronLeftIcon, Dialog, Input,
    MessageCircleIcon, PaperclipIcon, PlusIcon, SearchIcon, SendIcon, Textarea, UserPlusIcon
  } from '@kaordo/ui';
  import DraftAttachment from './DraftAttachment.svelte';
  import type MessageListComponent from './MessageList.svelte';
  import type { PendingMessage } from './types';

  let { user }: { user: UserIdentity } = $props();

  const api = createLigoApi(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL);
  const queryClient = new QueryClient();
  const conversationsQuery = createInfiniteQuery(() => ligoConversationOptions(api), () => queryClient);

  let selectedId = $state<string | null>(null);
  let dialogMode = $state<'new' | 'add' | null>(null);
  let groupMode = $state(false);
  let groupTitle = $state('');
  let selectedUsers = $state<LigoUser[]>([]);
  let searchInput = $state('');
  let searchTerm = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchFilter = $state('');
  let dialogBusy = $state(false);
  let dialogError = $state('');
  let selfBusy = $state(false);
  let sidebarError = $state('');
  let actionError = $state('');
  let connected = $state(true);
  let draft = $state('');
  let files = $state<File[]>([]);
  let fileInput = $state<HTMLInputElement>();
  let pending = $state<PendingMessage[]>([]);
  let LoadedMessageList = $state<typeof MessageListComponent | null>(null);
  let messageViewError = $state(false);
  let pageVisible = $state(true);
  let lastReadAttempt = '';
  const deliveredAttempts = new Map<string, string>();

  const searchQuery = createQuery(() => ligoUserSearchOptions(api, searchTerm, !!dialogMode), () => queryClient);
  const selectedQuery = createQuery(() => ligoConversationDetailOptions(api, selectedId), () => queryClient);
  const messagesQuery = createInfiniteQuery(() => ({
    ...ligoMessageOptions(api, selectedId!),
    enabled: !!selectedId
  }), () => queryClient);

  const conversations = $derived(conversationsQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const selfConversation = $derived(conversations.find((item) => item.kind === 'self'));
  const selected = $derived(conversations.find((item) => item.id === selectedId) ?? selectedQuery.data ?? null);
  const messages = $derived(messagesQuery.data?.pages.flatMap((page) => page.items).reverse() ?? []);
  const activePending = $derived(pending.filter((item) => item.conversationId === selectedId &&
    !messages.some((message) => message.clientId === item.clientId)));
  const visibleConversations = $derived(conversations.filter((item) => item.kind !== 'self' &&
    displayTitle(item).toLocaleLowerCase().includes(searchFilter.toLocaleLowerCase())
  ));

  $effect(() => {
    if (!selectedId || LoadedMessageList || messageViewError) return;
    void import('./MessageList.svelte')
      .then(({ default: component }) => { LoadedMessageList = component; })
      .catch(() => { messageViewError = true; });
  });

  $effect(() => {
    const id = selectedId;
    const latest = messages.at(-1);
    if (!id || !latest || !pageVisible) return;
    const key = id + ':' + latest.id;
    if (lastReadAttempt === key) return;
    lastReadAttempt = key;
    void api.markRead(id, latest.id).then(() =>
      queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] })
    ).catch(() => { lastReadAttempt = ''; });
  });

  $effect(() => {
    if (!pageVisible) return;
    for (const conversation of conversations) {
      const last = conversation.lastMessage;
      if (!last || last.senderId === user.id || deliveredAttempts.get(conversation.id) === last.id) continue;
      deliveredAttempts.set(conversation.id, last.id);
      void api.markDelivered(conversation.id, last.id).catch(() => {
        if (deliveredAttempts.get(conversation.id) === last.id) deliveredAttempts.delete(conversation.id);
      });
    }
  });

  onMount(() => {
    const syncHash = () => {
      const match = /^#c\/([0-9a-f-]{36})$/i.exec(window.location.hash);
      selectedId = match?.[1] ?? null;
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    const syncVisibility = () => { pageVisible = document.visibilityState === 'visible'; };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    const controller = new AbortController();
    void api.subscribe(controller.signal, (id) => {
      void queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] });
      if (!id || id === selectedId) {
        void queryClient.invalidateQueries({ queryKey: ['ligo', 'messages', selectedId] });
        if (selectedId) void queryClient.invalidateQueries({ queryKey: ['ligo', 'conversation', selectedId] });
      }
    }, (value) => { connected = value; }).catch((error) => {
      if (!controller.signal.aborted) actionError = error instanceof Error ? error.message : 'Live updates are unavailable.';
    });
    return () => {
      controller.abort();
      window.removeEventListener('hashchange', syncHash);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  });
  onDestroy(() => { if (searchTimer) clearTimeout(searchTimer); });

  function displayTitle(item: LigoConversation): string {
    if (item.kind === 'self') return 'Saved messages';
    if (item.kind === 'group') return item.title;
    return item.members.find((member) => member.id !== user.id)?.displayName ?? 'Direct chat';
  }

  function initials(title: string): string {
    return title.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'K';
  }

  function select(id: string) {
    selectedId = id;
    window.location.hash = `c/${id}`;
    actionError = '';
  }

  function closeConversation() {
    selectedId = null;
    window.location.hash = '';
  }

  function openDialog(mode: 'new' | 'add') {
    dialogMode = mode;
    groupMode = mode === 'add';
    groupTitle = '';
    selectedUsers = [];
    searchInput = '';
    searchTerm = '';
    dialogError = '';
  }

  function changeSearch(value: string) {
    searchInput = value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchTerm = value.trim(); }, 220);
  }

  function toggleUser(candidate: LigoUser) {
    selectedUsers = selectedUsers.some((item) => item.id === candidate.id)
      ? selectedUsers.filter((item) => item.id !== candidate.id)
      : [...selectedUsers, candidate];
  }

  async function directChat(candidate: LigoUser) {
    dialogBusy = true;
    dialogError = '';
    try {
      const conversation = await api.createConversation({ kind: 'duo', participantIds: [candidate.id] });
      await queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] });
      dialogMode = null;
      select(conversation.id);
    } catch (error) {
      dialogError = error instanceof Error ? error.message : 'Could not start the conversation.';
    } finally {
      dialogBusy = false;
    }
  }

  async function openSelf() {
    if (selfBusy) return;
    if (selfConversation) {
      dialogMode = null;
      select(selfConversation.id);
      return;
    }
    selfBusy = true;
    sidebarError = '';
    dialogError = '';
    try {
      const conversation = await api.createConversation({ kind: 'self', participantIds: [] });
      await queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] });
      dialogMode = null;
      select(conversation.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open Saved messages.';
      sidebarError = message;
      dialogError = message;
    } finally {
      selfBusy = false;
    }
  }

  async function confirmDialog() {
    if (selectedUsers.length === 0 || dialogBusy) return;
    dialogBusy = true;
    dialogError = '';
    try {
      const conversation = dialogMode === 'add' && selectedId
        ? await api.addMembers(selectedId, selectedUsers.map((item) => item.id))
        : await api.createConversation({
            kind: 'group', title: groupTitle.trim(),
            participantIds: selectedUsers.map((item) => item.id)
          });
      await queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['ligo', 'conversation', conversation.id] });
      dialogMode = null;
      select(conversation.id);
    } catch (error) {
      dialogError = error instanceof Error ? error.message : 'Could not update the conversation.';
    } finally {
      dialogBusy = false;
    }
  }

  function addFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const next = Array.from(input.files ?? []);
    if (files.length + next.length > 8) {
      actionError = 'Attach at most eight files.';
    } else {
      files = [...files, ...next];
      actionError = '';
    }
    input.value = '';
  }

  async function deliver(item: PendingMessage) {
    item.status = item.attachmentIds ? 'sending' : item.files.length ? 'uploading' : 'sending';
    item.error = undefined;
    try {
      if (!item.attachmentIds && item.files.length) {
        item.attachmentIds = await uploadMedia(item.files, import.meta.env.VITE_KAORDO_NODO_URL, api,
          (progress) => { item.progress = progress; }, { allowFiles: true, maxFiles: 8 });
      }
      item.status = 'sending';
      const message = await api.send(item.conversationId, {
        clientId: item.clientId,
        text: item.text,
        attachmentIds: item.attachmentIds ?? []
      });
      queryClient.setQueryData<InfiniteData<LigoMessagePage>>(
        ['ligo', 'messages', item.conversationId], (old) => {
          if (!old?.pages.length || old.pages.some((page) => page.items.some((entry) => entry.clientId === message.clientId))) return old;
          return {
            ...old,
            pages: [{ ...old.pages[0], items: [message, ...old.pages[0].items] }, ...old.pages.slice(1)]
          };
        }
      );
      pending = pending.filter((entry) => entry.clientId !== item.clientId);
      void queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] });
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Could not send the message.';
    }
  }

  function send() {
    if (!selectedId || (!draft.trim() && files.length === 0)) return;
    if (draft.length > 4000) { actionError = 'A message can contain up to 4,000 characters.'; return; }
    const item: PendingMessage = {
      clientId: crypto.randomUUID(), conversationId: selectedId, text: draft.trim(),
      files: [...files], progress: 0, status: files.length ? 'uploading' : 'sending',
      createdAt: new Date().toISOString()
    };
    pending = [...pending, item];
    draft = '';
    files = [];
    actionError = '';
    void deliver(item);
  }

  function composerKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function retry(item: PendingMessage) { void deliver(item); }

  function replaceMessage(message: LigoMessage) {
    queryClient.setQueryData<InfiniteData<LigoMessagePage>>(['ligo', 'messages', message.conversationId], (old) =>
      old ? { ...old, pages: old.pages.map((page) => ({ ...page, items: page.items.map((item) =>
        item.id === message.id ? message : item) })) } : old);
  }

  async function react(message: LigoMessage, emoji: LigoReaction['emoji']) {
    const current = message.reactions.find((item) => item.emoji === emoji);
    replaceMessage(await api.setReaction(message.conversationId, message.id, emoji, !current?.mine));
  }

  async function edit(message: LigoMessage, text: string) {
    replaceMessage(await api.editMessage(message.conversationId, message.id, text));
    void queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] });
  }

  async function remove(message: LigoMessage) {
    await api.deleteMessage(message.conversationId, message.id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ligo', 'messages', message.conversationId] }),
      queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] })
    ]);
  }

  function formatLast(value: string): string {
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }
</script>

<div class="flex h-[100dvh] flex-col bg-background">
  <header class="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-card/90 px-4 shadow-xs backdrop-blur-xl sm:px-6">
    <div class="flex items-baseline gap-2">
      <a href={appPaths.portal} rel="external" class="text-sm font-bold tracking-[-0.03em] text-primary">Kaordo</a>
      <span class="text-muted-foreground/60" aria-hidden="true">/</span>
      <h1 class="text-base font-bold tracking-[-0.04em]">Ligo</h1>
    </div>
    <Button href={appPaths.portal} rel="external" variant="ghost" size="sm">All apps <ArrowUpRightIcon class="size-4" /></Button>
  </header>

  <main class="mx-auto flex min-h-0 w-full max-w-[90rem] flex-1 overflow-hidden">
    <aside class={`flex w-full shrink-0 flex-col border-r border-border/75 bg-card/75 md:w-[20rem] lg:w-[21rem] ${selectedId ? 'hidden md:flex' : ''}`}
      aria-label="Conversations">
      <div class="border-b border-border/70 px-4 pb-4 pt-4">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">Messages</p>
            <h2 class="mt-0.5 text-xl font-bold tracking-tight">Chats</h2>
          </div>
          <Button size="icon-sm" aria-label="New conversation" class="rounded-xl shadow-sm" onclick={() => openDialog('new')}><PlusIcon class="size-4.5" /></Button>
        </div>
        <label class="relative block">
          <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Filter conversations" placeholder="Find a chat" class="h-10 rounded-xl border-border/80 bg-background pl-10" bind:value={searchFilter} />
        </label>
      </div>
      <div class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {#if !searchFilter || 'saved messages'.includes(searchFilter.toLocaleLowerCase())}
          <button type="button" disabled={selfBusy} onclick={() => void openSelf()}
            aria-current={selfConversation?.id === selectedId ? 'page' : undefined}
            class="mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow] hover:bg-accent focus-visible:outline-3 focus-visible:outline-ring"
            class:shadow-sm={selfConversation?.id === selectedId}
            class:bg-accent={selfConversation?.id === selectedId}>
            <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><BookmarkIcon class="size-5" /></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">Saved messages</span>
              <span class="block truncate text-xs text-muted-foreground">{selfConversation?.lastMessage?.deleted ? 'Message deleted' : selfConversation?.lastMessage?.text || 'Notes and files just for you'}</span>
            </span>
          </button>
        {/if}
        {#if sidebarError}<p class="px-3 py-2 text-xs text-destructive" role="alert">{sidebarError}</p>{/if}
        {#if conversationsQuery.isPending}
          <div class="space-y-2 p-2" role="status" aria-label="Loading conversations">
            {#each [1, 2, 3] as item}<div class="h-17 animate-pulse rounded-xl bg-muted" aria-hidden="true"></div>{/each}
          </div>
        {:else if conversationsQuery.error}
          <div class="p-4 text-sm text-destructive" role="alert">
            Could not load conversations.
            <Button variant="outline" size="sm" class="mt-3" onclick={() => void conversationsQuery.refetch()}>Retry</Button>
          </div>
        {:else if visibleConversations.length === 0}
          <div class="px-5 py-12 text-center text-sm text-muted-foreground">
            <div class="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-accent"><MessageCircleIcon class="size-6 text-primary" /></div>
            <p class="font-semibold text-foreground">{searchFilter ? 'No chats match your search' : 'Start a conversation'}</p>
            <p class="mt-1">{searchFilter ? 'Try another name.' : 'Find someone by username, or keep a note for yourself.'}</p>
            {#if !searchFilter}<Button variant="outline" size="sm" class="mt-4" onclick={() => openDialog('new')}>New chat</Button>{/if}
          </div>
        {:else}
          {#each visibleConversations as conversation (conversation.id)}
            {@const title = displayTitle(conversation)}
            <button type="button" onclick={() => select(conversation.id)} aria-current={selectedId === conversation.id ? 'page' : undefined}
              class="mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow] hover:bg-accent focus-visible:outline-3 focus-visible:outline-ring"
              class:shadow-sm={selectedId === conversation.id}
              class:bg-accent={selectedId === conversation.id}>
              <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-sm font-bold text-primary">
                {conversation.kind === 'group' ? '◌' : initials(title)}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm font-semibold">{title}</span>
                  {#if conversation.lastMessage}
                    <time class="shrink-0 text-[11px] text-muted-foreground" datetime={conversation.lastMessage.createdAt}>
                      {formatLast(conversation.lastMessage.createdAt)}
                    </time>
                  {/if}
                </span>
                <span class="mt-1 flex items-center justify-between gap-2">
                  <span class="truncate text-xs text-muted-foreground">
                    {conversation.lastMessage?.deleted ? 'Message deleted' : conversation.lastMessage?.text || (conversation.lastMessage ? 'Attachment' : conversation.kind === 'group' ? 'Group is ready' : 'Say hello')}
                  </span>
                  {#if conversation.unreadCount > 0}
                    <span class="grid min-w-5 h-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
                      aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>
                  {/if}
                </span>
              </span>
            </button>
          {/each}
          {#if conversationsQuery.hasNextPage}
            <div class="py-3 text-center">
              <Button variant="ghost" size="sm" disabled={conversationsQuery.isFetchingNextPage}
                onclick={() => void conversationsQuery.fetchNextPage()}>
                {conversationsQuery.isFetchingNextPage ? 'Loading…' : 'More conversations'}
              </Button>
            </div>
          {/if}
        {/if}
      </div>
    </aside>

    <section class={`min-h-0 min-w-0 flex-1 flex-col ${selectedId ? 'flex' : 'hidden md:flex'}`} aria-label="Selected conversation">
      {#if selectedId}
        <div class="flex min-h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-card/70 px-4 py-2.5 shadow-xs sm:px-6">
          <Button class="md:hidden" variant="ghost" size="icon-sm" aria-label="Back to conversations" onclick={closeConversation}>
            <ChevronLeftIcon class="size-5" />
          </Button>
          <div class="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-sm font-bold text-primary">
            {#if selected?.kind === 'self'}<BookmarkIcon class="size-5" />{:else}{selected?.kind === 'group' ? '◌' : initials(selected ? displayTitle(selected) : 'Ligo')}{/if}
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-bold">{selected ? displayTitle(selected) : 'Conversation'}</h2>
            <p class="truncate text-xs text-muted-foreground">
              {selected?.kind === 'self' ? 'Only you' : selected?.kind === 'group' ? `${selected.members.length} members` : selected?.members.find((member) => member.id !== user.id)?.username ?? 'Loading…'}
              {#if !connected}<span class="ml-2 text-amber-700">· Reconnecting…</span>{/if}
            </p>
          </div>
          {#if selected?.kind === 'group' && selected.createdBy === user.id}
            <Button variant="ghost" size="icon-sm" aria-label="Add people to group" onclick={() => openDialog('add')}>
              <UserPlusIcon class="size-5" />
            </Button>
          {/if}
        </div>
        {#if messagesQuery.error}
          <div class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">
            Could not load messages.
            <Button variant="outline" size="xs" class="ml-2" onclick={() => void messagesQuery.refetch()}>Retry</Button>
          </div>
        {:else if messageViewError}
          <div class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">
            Could not load the conversation view.
            <Button variant="outline" size="xs" class="ml-2" onclick={() => { messageViewError = false; }}>Retry</Button>
          </div>
        {:else if messagesQuery.isPending || !LoadedMessageList}
          <div class="flex flex-1 flex-col justify-end gap-3 p-6" role="status" aria-label="Loading messages">
            <div class="h-14 w-1/2 animate-pulse rounded-2xl bg-muted"></div>
            <div class="ml-auto h-20 w-2/3 animate-pulse rounded-2xl bg-muted"></div>
          </div>
        {:else}
          <LoadedMessageList conversationId={selectedId} {messages} pending={activePending}
            viewerId={user.id} personal={selected?.kind === 'self'} group={selected?.kind === 'group'}
            hasMore={!!messagesQuery.hasNextPage} loadingMore={messagesQuery.isFetchingNextPage}
            loadOlder={async () => { await messagesQuery.fetchNextPage(); }} {retry} {react} {edit} {remove} />
        {/if}
        <div class="shrink-0 border-t border-border/75 bg-card/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl sm:px-6">
          {#if files.length}
            <div class={`kaordo-scrollbar mb-3 grid max-h-56 gap-2 overflow-y-auto ${files.length === 1 ? 'max-w-60 grid-cols-1' : files.length === 2 ? 'max-w-[32rem] grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}
              aria-label="Selected attachments">
              {#each files as file, index (file)}
                <DraftAttachment {file}
                  remove={() => {
                    files = files.filter((_, i) => i !== index);
                  }} />
              {/each}
            </div>
          {/if}
          {#if actionError}<p class="mb-2 text-sm text-destructive" role="alert">{actionError}</p>{/if}
          <div class="flex items-end gap-2 rounded-[1.25rem] border border-border/80 bg-background p-2 shadow-sm transition-[box-shadow,border-color] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/20">
            <input bind:this={fileInput} type="file" multiple
              class="sr-only" aria-label="Choose files" onchange={addFiles} />
            <Button variant="ghost" size="icon-sm" aria-label="Attach files" disabled={files.length >= 8}
              onclick={() => fileInput?.click()}><PaperclipIcon class="size-5" /></Button>
            <Textarea bind:value={draft} onkeydown={composerKey} maxlength={4000} rows={1} placeholder="Write a message…"
              aria-label="Write a message" class="kaordo-scrollbar min-h-9 max-h-36 min-w-0 flex-1 overflow-y-auto border-0 bg-transparent px-1 py-2 text-sm leading-5 shadow-none focus-visible:ring-0" />
            <Button size="icon-sm" aria-label="Send message" disabled={!draft.trim() && !files.length} onclick={send}>
              <SendIcon class="size-4" />
            </Button>
          </div>
          <p class="mt-1.5 text-center text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
        </div>
      {:else}
        <div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div class="grid size-20 place-items-center rounded-[1.75rem] bg-accent"><MessageCircleIcon class="size-10 text-primary" /></div>
          <h2 class="mt-6 text-2xl font-bold tracking-tight">Stay in touch</h2>
          <p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Choose a conversation, save a note for yourself, or find someone by username.</p>
          <div class="mt-6 flex flex-wrap justify-center gap-2">
            <Button onclick={() => openDialog('new')}><PlusIcon class="size-4" /> New chat</Button>
            <Button variant="outline" disabled={selfBusy} onclick={() => void openSelf()}><BookmarkIcon class="size-4" /> Saved messages</Button>
          </div>
        </div>
      {/if}
    </section>
  </main>
</div>

<Dialog.Root open={!!dialogMode} onOpenChange={(open) => { if (!open && !dialogBusy) dialogMode = null; }}>
  <Dialog.Content class="max-h-[90dvh] overflow-hidden p-2 sm:max-w-lg">
    <div class="kaordo-scrollbar max-h-[calc(90dvh-1rem)] overflow-y-auto p-3 sm:p-5">
      <Dialog.Header class="mb-5 pr-10">
        <Dialog.Title class="text-xl font-bold">{dialogMode === 'add' ? 'Add people' : groupMode ? 'New group' : 'New conversation'}</Dialog.Title>
        <Dialog.Description>Find Kaordo accounts by username. {dialogMode === 'add' ? 'New members can read messages sent after they join.' : 'Start a direct chat, create a group, or save a note for yourself.'}</Dialog.Description>
      </Dialog.Header>
      {#if dialogMode === 'new'}
        <button type="button" disabled={selfBusy} onclick={() => void openSelf()}
          class="mb-4 flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
          <BookmarkIcon class="size-5 text-primary" />
          <span><span class="block text-sm font-semibold">Saved messages</span><span class="block text-xs text-muted-foreground">A private chat with yourself</span></span>
        </button>
        <label class="mb-4 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" bind:checked={groupMode} class="size-4 accent-primary" />
          Create a group
        </label>
      {/if}
      {#if groupMode && dialogMode === 'new'}
        <label class="mb-4 block text-xs font-semibold uppercase tracking-wider text-muted-foreground" for="ligo-group-title">Group name</label>
        <Input id="ligo-group-title" class="mb-4" maxlength={100} placeholder="Give your group a name" bind:value={groupTitle} />
      {/if}
      <label class="block text-xs font-semibold uppercase tracking-wider text-muted-foreground" for="ligo-user-search">Find people</label>
      <div class="relative mt-2">
        <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id="ligo-user-search" class="pl-10" placeholder="Search by username" value={searchInput}
          oninput={(event) => changeSearch(event.currentTarget.value)} />
      </div>
      {#if selectedUsers.length}
        <div class="mt-3 flex flex-wrap gap-2">
          {#each selectedUsers as candidate (candidate.id)}
            <button type="button" class="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary hover:brightness-95"
              onclick={() => toggleUser(candidate)} aria-label={`Remove ${candidate.username}`}>
              @{candidate.username} ×
            </button>
          {/each}
        </div>
      {/if}
      <div class="mt-4 min-h-24">
        {#if searchTerm.length < 2}
          <p class="py-5 text-center text-sm text-muted-foreground">Type at least two characters to search.</p>
        {:else if searchQuery.isPending}
          <p class="py-5 text-center text-sm text-muted-foreground" role="status">Searching accounts…</p>
        {:else if searchQuery.error}
          <p class="py-5 text-center text-sm text-destructive" role="alert">Search is unavailable. Try again.</p>
        {:else if !searchQuery.data?.items.length}
          <p class="py-5 text-center text-sm text-muted-foreground">No accounts found.</p>
        {:else}
          {#each searchQuery.data.items.filter((candidate) => dialogMode !== 'add' || !selected?.members.some((member) => member.id === candidate.id)) as candidate (candidate.id)}
            <button type="button" disabled={dialogBusy} onclick={() => groupMode ? toggleUser(candidate) : void directChat(candidate)}
              class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
              <span class="grid size-9 place-items-center rounded-xl bg-primary/10 text-xs font-bold text-primary">{initials(candidate.displayName)}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold">{candidate.displayName}</span>
                <span class="block truncate text-xs text-muted-foreground">@{candidate.username}</span>
              </span>
              {#if selectedUsers.some((item) => item.id === candidate.id)}<CheckIcon class="size-4 text-primary" />{/if}
            </button>
          {/each}
        {/if}
      </div>
      {#if dialogError}<p class="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{dialogError}</p>{/if}
      {#if groupMode}
        <Dialog.Footer class="mt-5 flex flex-row justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" disabled={dialogBusy} onclick={() => { dialogMode = null; }}>Cancel</Button>
          <Button disabled={dialogBusy || !selectedUsers.length || (dialogMode === 'new' && !groupTitle.trim())}
            onclick={() => void confirmDialog()}>
            {dialogBusy ? 'Working…' : dialogMode === 'add' ? 'Add people' : 'Create group'}
          </Button>
        </Dialog.Footer>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
