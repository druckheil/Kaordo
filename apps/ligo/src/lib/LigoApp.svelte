<script lang="ts">
  // Composes Ligo conversation navigation, shared message state and read acknowledgements

  import { onDestroy, onMount } from 'svelte';
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import { createInfiniteQuery, createQuery, QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { createLigoApi, ligoConversationDetailOptions, ligoConversationOptions } from '@kaordo/api-client';
  import type { UserIdentity } from '@kaordo/contracts';
  import { UserAvatar } from '@kaordo/account-ui';
  import { createConversationState } from '@kaordo/chat-client';
  import { appPaths } from '@kaordo/links';
  import {
    AppHeader, BookmarkIcon, Button, ChevronLeftIcon, MessageCircleIcon,
    PlusIcon, UserPlusIcon
  } from '@kaordo/ui';
  import type MessageListComponent from '@kaordo/chat-ui/message-list';
  import ConversationDialog from './ConversationDialog.svelte';
  import MessageComposer from '@kaordo/chat-ui/message-composer';
  import ConversationSidebar from './ConversationSidebar.svelte';
  import { createReceiptState } from './receipt-state';
  import {
    conversationTitle,
    maxAttachmentsPerMessage,
    maxMessageCharacters,
    type ConversationDialogMode,
  } from './ligo-model';

  let { user }: { user: UserIdentity } = $props();

  const api = createLigoApi(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL);
  const queryClient = new QueryClient();
  const conversationsQuery = createInfiniteQuery(() => ligoConversationOptions(api), () => queryClient);

  let selectedId = $state<string | null>(null);
  let dialogMode = $state<ConversationDialogMode | null>(null);
  let searchFilter = $state('');
  let dialogError = $state('');
  let selfBusy = $state(false);
  let sidebarError = $state('');
  let actionError = $state('');
  let draft = $state('');
  let files = $state<File[]>([]);
  let LoadedMessageList = $state<typeof MessageListComponent | null>(null);
  let messageViewError = $state(false);
  let pageVisible = $state(true);
  let disposed = false;
  const lifetime = new AbortController();

  const selectedQuery = createQuery(() => ligoConversationDetailOptions(api, selectedId), () => queryClient);
  const chat = createConversationState({
    api, queryClient, nodoBaseUrl: import.meta.env.VITE_KAORDO_NODO_URL,
    selectedId: () => selectedId, onHint: invalidateConversationHints,
    onChanged: invalidateConversations
  });
  const receipts = createReceiptState(api, () => user.id, invalidateConversations);
  const messagesQuery = chat.query;
  onDestroy(() => {
    disposed = true;
    lifetime.abort();
    receipts.dispose();
    chat.dispose();
    void queryClient.cancelQueries();
    queryClient.clear();
  });

  const conversations = $derived(conversationsQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const selfConversation = $derived(conversations.find((conversation) => conversation.kind === 'self'));
  const selected = $derived(conversations.find((conversation) => conversation.id === selectedId) ?? selectedQuery.data ?? null);
  const messages = $derived(chat.messages);
  const activePending = $derived(chat.activePending);
  const liveUnavailable = $derived(chat.liveUnavailable);
  const connected = $derived(chat.connected);
  const selectedTitle = $derived(selected ? conversationTitle(selected, user.id) : 'Conversation');
  const selectedPeer = $derived(selected?.kind === 'duo' ? selected.members.find((member) => member.id !== user.id) : undefined);
  const selectedSubtitle = $derived.by(() => {
    if (selected?.kind === 'self') return 'Only you';
    if (selected?.kind === 'group') return `${selected.members.length} members`;
    return selected?.members.find((member) => member.id !== user.id)?.username ?? 'Loading…';
  });

  $effect(() => {
    if (!selectedId || LoadedMessageList || messageViewError) return;
    void import('@kaordo/chat-ui/message-list')
      .then(({ default: component }) => { if (!disposed) LoadedMessageList = component; })
      .catch(() => { if (!disposed) messageViewError = true; });
  });

  $effect(() => {
    const conversationId = selectedId;
    const latestMessage = messages.at(-1);
    if (!conversationId || !latestMessage || !pageVisible) return;
    receipts.markRead(conversationId, latestMessage.id);
  });

  $effect(() => {
    const currentConversations = conversations;
    if (pageVisible) receipts.markDelivered(currentConversations);
  });

  onMount(() => {
    const syncSelectedConversation = () => {
      const match = /^#c\/([0-9a-f-]{36})$/i.exec(window.location.hash);
      selectedId = match?.[1] ?? null;
    };
    const syncPageVisibility = () => {
      pageVisible = document.visibilityState === 'visible';
    };

    syncSelectedConversation();
    syncPageVisibility();
    window.addEventListener('hashchange', syncSelectedConversation);
    window.addEventListener('popstate', syncSelectedConversation);
    document.addEventListener('visibilitychange', syncPageVisibility);

    chat.connect();

    return () => {
      window.removeEventListener('hashchange', syncSelectedConversation);
      window.removeEventListener('popstate', syncSelectedConversation);
      document.removeEventListener('visibilitychange', syncPageVisibility);
    };
  });

  function invalidateConversations(): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: ['ligo', 'conversations'] }).then(() => undefined);
  }

  function invalidateConversationHints(conversationId: string | null): void {
    void invalidateConversations();
    if (conversationId && conversationId !== selectedId) return;

    if (selectedId) {
      void queryClient.invalidateQueries({ queryKey: ['ligo', 'conversation', selectedId] });
    }
  }

  function selectConversation(id: string): void {
    selectedId = id;
    if (window.location.hash !== `#c/${id}`) pushState(`#c/${id}`, page.state);
    actionError = '';
  }

  function closeConversation(): void {
    selectedId = null;
    if (window.location.hash) pushState('', page.state);
  }

  function openDialog(mode: ConversationDialogMode): void {
    dialogError = '';
    dialogMode = mode;
  }

  async function openSavedMessages(): Promise<void> {
    if (selfBusy) return;
    if (selfConversation) {
      dialogMode = null;
      selectConversation(selfConversation.id);
      return;
    }

    selfBusy = true;
    sidebarError = '';
    dialogError = '';
    try {
      const conversation = await api.createConversation({ kind: 'self', participantIds: [] }, lifetime.signal);
      if (disposed) return;
      await invalidateConversations();
      if (disposed) return;
      dialogMode = null;
      selectConversation(conversation.id);
    } catch (cause) {
      if (disposed) return;
      const message = cause instanceof Error ? cause.message : 'Could not open Saved messages.';
      sidebarError = message;
      dialogError = message;
    } finally {
      if (!disposed) selfBusy = false;
    }
  }

  function send(): void {
    if (!selectedId || (!draft.trim() && files.length === 0)) return;
    if (draft.length > maxMessageCharacters) {
      actionError = `A message can contain up to ${maxMessageCharacters.toLocaleString()} characters.`;
      return;
    }

    chat.send(selectedId, draft, files);
    draft = '';
    files = [];
    actionError = '';
  }

</script>

<QueryClientProvider client={queryClient}>
<div class="flex h-[100dvh] flex-col bg-background">
  <AppHeader name="Ligo" homeHref={appPaths.portal} wide />

  <main
    id="main-content"
    tabindex="-1"
    class="mx-auto flex min-h-0 w-full max-w-[90rem] flex-1 overflow-hidden"
  >
    <ConversationSidebar
      {conversations}
      {selfConversation}
      currentUserId={user.id}
      {selectedId}
      loading={conversationsQuery.isPending}
      loadError={!!conversationsQuery.error}
      loadingMore={conversationsQuery.isFetchingNextPage}
      hasMore={!!conversationsQuery.hasNextPage}
      savedBusy={selfBusy}
      savedError={sidebarError}
      bind:filter={searchFilter}
      onNewConversation={() => openDialog('new')}
      onOpenSaved={() => void openSavedMessages()}
      onSelect={selectConversation}
      onRetry={() => void conversationsQuery.refetch()}
      onLoadMore={() => void conversationsQuery.fetchNextPage()}
    />

    <section
      class={`min-h-0 min-w-0 flex-1 flex-col ${selectedId ? 'flex' : 'hidden md:flex'}`}
      aria-label="Selected conversation"
    >
      {#if selectedId}
        <div class="flex min-h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-card/70 px-4 py-2.5 shadow-xs sm:px-6">
          <Button
            class="md:hidden"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to conversations"
            onclick={closeConversation}
          >
            <ChevronLeftIcon class="size-5" />
          </Button>
          {#if selectedPeer}
            <UserAvatar user={selectedPeer} class="size-10" />
          {:else}
          <div class="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary-soft text-sm font-bold text-primary-soft-foreground">
            {#if selected?.kind === 'self'}
              <BookmarkIcon class="size-5" />
            {:else if selected?.kind === 'group'}
              ◌
            {:else}
              <MessageCircleIcon class="size-5" />
            {/if}
          </div>
          {/if}
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-bold">{selectedTitle}</h2>
            <p class="truncate text-xs text-muted-foreground">
              {selectedSubtitle}
              {#if !connected}
                <span class="ml-2 text-amber-700 dark:text-amber-300" role="status">· {liveUnavailable ? 'Live updates unavailable' : 'Reconnecting…'}</span>
              {/if}
            </p>
          </div>
          {#if selected?.kind === 'group' && selected.createdBy === user.id}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add people to group"
              onclick={() => openDialog('add')}
            >
              <UserPlusIcon class="size-5" />
            </Button>
          {/if}
        </div>

        {#if liveUnavailable}
          <div class="flex shrink-0 items-center gap-3 border-b border-border bg-muted/35 px-4 py-2">
            <p class="min-w-0 flex-1 text-xs leading-5 text-muted-foreground" role="status">Messages refresh automatically while live updates are paused.</p>
            <Button variant="outline" size="xs" onclick={chat.connect} aria-label="Reconnect live updates">Reconnect</Button>
          </div>
        {/if}
        {#if messagesQuery.error}
          <div class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">
            Could not load messages.
            <Button variant="outline" size="xs" class="ml-2" onclick={() => void messagesQuery.refetch()}>
              Retry
            </Button>
          </div>
        {:else if messageViewError}
          <div class="m-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">
            Could not load the conversation view.
            <Button variant="outline" size="xs" class="ml-2" onclick={() => { messageViewError = false; }}>
              Retry
            </Button>
          </div>
        {:else if messagesQuery.isPending || !LoadedMessageList}
          <div class="flex flex-1 flex-col justify-end gap-3 p-6" role="status" aria-label="Loading messages">
            <div class="h-14 w-1/2 animate-pulse rounded-2xl bg-muted"></div>
            <div class="ml-auto h-20 w-2/3 animate-pulse rounded-2xl bg-muted"></div>
          </div>
        {:else}
          {#key selectedId}
            <LoadedMessageList
              {messages}
              pending={activePending}
              viewerId={user.id}
              personal={selected?.kind === 'self'}
              group={selected?.kind === 'group'}
              hasMore={!!messagesQuery.hasNextPage}
              loadingMore={messagesQuery.isFetchingNextPage}
              loadOlder={async () => { await messagesQuery.fetchNextPage(); }}
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
          maxAttachments={maxAttachmentsPerMessage}
          maxCharacters={maxMessageCharacters}
          onSend={send}
        />
      {:else}
        <div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div class="grid size-20 place-items-center rounded-[1.75rem] bg-accent">
            <MessageCircleIcon class="size-10 text-accent-foreground" />
          </div>
          <h2 class="mt-6 text-2xl font-bold tracking-tight">Stay in touch</h2>
          <p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Choose a conversation, save a note for yourself, or find someone by username.
          </p>
          <div class="mt-6 flex flex-wrap justify-center gap-2">
            <Button onclick={() => openDialog('new')}><PlusIcon class="size-4" /> New chat</Button>
            <Button variant="outline" disabled={selfBusy} onclick={() => void openSavedMessages()}>
              <BookmarkIcon class="size-4" /> Saved messages
            </Button>
          </div>
        </div>
      {/if}
    </section>
  </main>
</div>

<ConversationDialog
  {api}
  {queryClient}
  {selectedId}
  {selected}
  {selfBusy}
  savedError={dialogError}
  bind:open={dialogMode}
  onOpenSaved={() => void openSavedMessages()}
  onSelectConversation={selectConversation}
/>
</QueryClientProvider>
