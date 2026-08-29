<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { onDestroy, onMount, tick } from 'svelte';
  import type { LigoAttachment, LigoConversation, LigoMessage, LigoUser } from '../../lib/domain/ligo';
  import { PUBLIC_LIGO_DESTINATION } from '../../lib/gateways/NodeLigoTransport';
  import { ligoAttachmentUrls } from '../../lib/services/LigoAttachmentUrls';
  import type { LigoGState, LigoSnapshot } from '../../lib/states/LigoGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import LigoStorageDialog from './LigoStorageDialog.svelte';
  import LigoVideoPlayer from './LigoVideoPlayer.svelte';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';
  import PhotoViewer from '../ui/PhotoViewer.svelte';

  type Props = { snapshot: Readonly<LigoSnapshot>; state: LigoGState };
  type ImageDimensions = { height: number; width: number };
  let { snapshot, state: ligoState }: Props = $props();
  let fileInput = $state<HTMLInputElement>();
  let composer = $state<HTMLTextAreaElement>();
  let messageList = $state<HTMLElement>();
  let conversationList = $state<HTMLElement>();
  let conversationStart = $state(0);
  let conversationEnd = $state(24);
  let storageOpen = $state(false);
  let previewImage = $state<LigoAttachment | null>(null);
  let previewImageDimensions = $state<ImageDimensions | null>(null);
  const imageDimensions = new Map<string, ImageDimensions>();
  let latestMessageId = '';
  let restoringUserId = $state<string | null>(null);
  let initialRestore = $state(true);
  let followsBottom = true;
  let lastVirtualHeight = 0;
  let bottomSyncFrame = 0;
  let messageLayoutFrame = 0;
  let messageScrollFrame = 0;
  let lastMessageListWidth = 0;
  const conversationHeight = 62;
  const messageGap = 6;
  const messagePadding = 24;
  const messageOverscan = 50;
  let visibleConversations = $derived(snapshot.conversations.slice(conversationStart, conversationEnd));
  let publicAvailable = $derived(Boolean(snapshot.publicStorage?.nodeCandidates.length));
  let selectedPrivate = $derived(snapshot.nodes.find(({ id }) => id === snapshot.selectedNodeId));
  let selectedNodeName = $derived(snapshot.selectedNodeId === PUBLIC_LIGO_DESTINATION
    ? 'Public Nodo'
    : selectedPrivate?.deviceName ?? 'Nodo unavailable');
  let destinationReady = $derived(snapshot.selectedNodeId === PUBLIC_LIGO_DESTINATION
    ? publicAvailable : Boolean(selectedPrivate?.online && selectedPrivate.policy.allowUploads));
  let progress = $derived(snapshot.uploadProgress ? Math.round(snapshot.uploadProgress.uploadedBytes /
    Math.max(1, snapshot.uploadProgress.totalBytes) * 100) : 0);

  const messageVirtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
    count: 0,
    estimateSize: estimateMessageHeight,
    gap: messageGap,
    getItemKey: messageKey,
    getScrollElement: () => messageList ?? null,
    initialRect: { height: 720, width: 820 },
    measureElement: measureMessageElement,
    overscan: messageOverscan,
    paddingEnd: messagePadding,
    paddingStart: messagePadding,
    useAnimationFrameWithResizeObserver: false,
  });
  let virtualMessages = $derived($messageVirtualizer.getVirtualItems());
  let virtualMessageHeight = $derived($messageVirtualizer.getTotalSize());

  onMount(() => {
    latestMessageId = snapshot.messages.at(-1)?.id ?? '';
    restoringUserId = snapshot.activeUser?.id ?? null;
    initialRestore = false;
    if (restoringUserId) void restoreScroll(restoringUserId);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMessageLayout);
    if (messageList) resizeObserver?.observe(messageList);
    scheduleMessageLayout();
    return () => {
      resizeObserver?.disconnect();
      if (bottomSyncFrame) cancelAnimationFrame(bottomSyncFrame);
      if (messageLayoutFrame) cancelAnimationFrame(messageLayoutFrame);
      if (messageScrollFrame) cancelAnimationFrame(messageScrollFrame);
    };
  });
  onDestroy(rememberScroll);

  $effect(() => {
    const count = snapshot.messages.length;
    const scrollElement = messageList;
    get(messageVirtualizer).setOptions({
      count,
      estimateSize: estimateMessageHeight,
      gap: messageGap,
      getItemKey: messageKey,
      getScrollElement: () => scrollElement ?? null,
      overscan: messageOverscan,
      paddingEnd: messagePadding,
      paddingStart: messagePadding,
      useAnimationFrameWithResizeObserver: false,
    });
  });

  $effect(() => {
    const nextHeight = virtualMessageHeight;
    if (nextHeight === lastVirtualHeight) return;
    lastVirtualHeight = nextHeight;
    if (followsBottom && restoringUserId !== snapshot.activeUser?.id) scheduleBottomSync();
  });

  $effect(() => {
    if (initialRestore) return;
    const nextId = snapshot.messages.at(-1)?.id ?? '';
    if (!nextId || nextId === latestMessageId) return;
    if (restoringUserId === snapshot.activeUser?.id) {
      latestMessageId = nextId;
      return;
    }
    const followsLatest = !messageList || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 96;
    latestMessageId = nextId;
    if (followsLatest) void scrollBottom();
  });

  async function open(user: LigoUser) {
    rememberScroll();
    restoringUserId = user.id;
    await ligoState.openConversation(user);
    await restoreScroll(user.id);
  }
  function selectConversation(conversation: LigoConversation) { open(conversation.user); }
  function updateSearch(event: Event) { ligoState.setSearch((event.currentTarget as HTMLInputElement).value); }
  function resizeDraft(event: Event) {
    const target = event.currentTarget as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = `${Math.min(148, target.scrollHeight)}px`;
  }
  function attach(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files) ligoState.addFiles([...input.files]);
    input.value = '';
  }
  async function send() {
    if (!await ligoState.send()) return;
    if (composer) composer.style.height = '';
    await scrollBottom();
    composer?.focus({ preventScroll: true });
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send();
  }
  async function scrollBottom() {
    await tick();
    if (!messageList) return;
    followsBottom = true;
    const lastIndex = snapshot.messages.length - 1;
    if (lastIndex >= 0) get(messageVirtualizer).scrollToIndex(lastIndex, { align: 'end' });
    await nextFrame();
    messageList.scrollTop = messageList.scrollHeight;
    rememberScroll();
  }
  function scheduleBottomSync(): void {
    if (bottomSyncFrame) return;
    bottomSyncFrame = requestAnimationFrame(() => {
      bottomSyncFrame = 0;
      if (!messageList || !followsBottom || restoringUserId === snapshot.activeUser?.id) return;
      messageList.scrollTop = messageList.scrollHeight;
    });
  }
  function rememberScroll() {
    const userId = snapshot.activeUser?.id;
    if (!messageList || !userId || restoringUserId === userId) return;
    const viewport = messageList.getBoundingClientRect();
    const messages = [...messageList.querySelectorAll<HTMLElement>('[data-message-id]')];
    const anchor = messages.find((message) => message.getBoundingClientRect().bottom > viewport.top + 1) ?? null;
    followsBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 4;
    ligoState.rememberScroll(userId, {
      atBottom: followsBottom,
      messageId: anchor?.dataset.messageId ?? null,
      offset: anchor ? anchor.getBoundingClientRect().top - viewport.top : 0,
      scrollTop: messageList.scrollTop,
    });
  }
  async function restoreScroll(userId: string) {
    await tick();
    if (!messageList || snapshot.activeUser?.id !== userId || restoringUserId !== userId) return;
    const remembered = ligoState.rememberedScroll(userId);
    if (!remembered || remembered.atBottom) {
      followsBottom = true;
      const lastIndex = snapshot.messages.length - 1;
      if (lastIndex >= 0) get(messageVirtualizer).scrollToIndex(lastIndex, { align: 'end' });
      await nextFrame();
      messageList.scrollTop = messageList.scrollHeight;
    } else {
      followsBottom = false;
      const index = snapshot.messages.findIndex(({ id }) => id === remembered.messageId);
      if (index >= 0) {
        get(messageVirtualizer).scrollToIndex(index, { align: 'start' });
        await nextFrame();
      }
      const viewportTop = messageList.getBoundingClientRect().top;
      const anchor = [...messageList.querySelectorAll<HTMLElement>('[data-message-id]')]
        .find((message) => message.dataset.messageId === remembered.messageId);
      if (anchor) {
        messageList.scrollTop += anchor.getBoundingClientRect().top - viewportTop - remembered.offset;
      } else {
        messageList.scrollTop = remembered.scrollTop;
      }
    }
    latestMessageId = snapshot.messages.at(-1)?.id ?? '';
    restoringUserId = null;
  }
  function messageKey(index: number): string | number {
    return snapshot.messages[index]?.id ?? index;
  }
  function estimateMessageHeight(index: number): number {
    const message = snapshot.messages[index];
    if (!message) return 52;
    const remembered = ligoState.rememberedMessageHeight(message.id, messageLayoutKey());
    if (remembered) return remembered;
    const listWidth = Math.max(320, messageList?.clientWidth ?? 820);
    const messageWidth = Math.min(584, Math.max(220, (listWidth - 80) * .7));
    const mediaHeight = Math.max(148, Math.round((messageWidth - 10) * 9 / 16));
    let attachmentsHeight = 0;
    for (const attachment of message.attachments) {
      if (attachment.mimeType.startsWith('video/')) attachmentsHeight += mediaHeight;
      else if (attachment.mimeType.startsWith('image/')) attachmentsHeight += Math.min(380, mediaHeight);
      else attachmentsHeight += 52;
    }
    if (message.attachments.length > 1) attachmentsHeight += (message.attachments.length - 1) * 5;
    const textLines = message.body ? Math.max(1, Math.min(12, Math.ceil(message.body.length / 48))) : 0;
    return Math.max(38, attachmentsHeight + textLines * 20 + (message.attachments.length ? 32 : 22));
  }
  function measureMessageElement(node: HTMLDivElement): number {
    const measured = node.offsetHeight;
    if (measured > 0) {
      const messageId = node.dataset.messageId;
      if (messageId) ligoState.rememberMessageHeight(messageId, messageLayoutKey(), measured);
      return measured;
    }
    const index = Number(node.dataset.index);
    return Number.isSafeInteger(index) ? estimateMessageHeight(index) : 52;
  }
  function measureMessage(node: HTMLDivElement) {
    get(messageVirtualizer).measureElement(node);
    return {
      update: () => get(messageVirtualizer).measureElement(node),
      destroy: () => get(messageVirtualizer).measureElement(null),
    };
  }
  function messageLayoutKey(): string {
    const textScale = typeof document === 'undefined'
      ? '1'
      : getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim() || '1';
    return `${Math.round(messageList?.clientWidth ?? 0)}:${textScale}:${globalThis.devicePixelRatio ?? 1}`;
  }
  function scheduleMessageLayout(): void {
    if (messageLayoutFrame) return;
    messageLayoutFrame = requestAnimationFrame(() => {
      messageLayoutFrame = 0;
      const width = messageList?.clientWidth ?? 0;
      if (width <= 0 || width === lastMessageListWidth) return;
      lastMessageListWidth = width;
      get(messageVirtualizer).measure();
    });
  }
  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  function onScroll(): void {
    if (messageScrollFrame) return;
    messageScrollFrame = requestAnimationFrame(() => {
      messageScrollFrame = 0;
      void processMessageScroll();
    });
  }
  async function processMessageScroll(): Promise<void> {
    rememberScroll();
    if (!messageList || restoringUserId === snapshot.activeUser?.id || messageList.scrollTop > 100 ||
        !snapshot.hasOlder || snapshot.loadingOlder) return;
    const anchorId = snapshot.messages[0]?.id ?? null;
    const anchor = anchorId
      ? messageList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchorId)}"]`)
      : null;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - messageList.getBoundingClientRect().top : 0;
    await ligoState.loadOlder();
    await tick();
    const index = anchorId ? snapshot.messages.findIndex(({ id }) => id === anchorId) : -1;
    if (index >= 0) {
      get(messageVirtualizer).scrollToIndex(index, { align: 'start' });
      await nextFrame();
      const restored = messageList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchorId!)}"]`);
      if (restored) messageList.scrollTop += restored.getBoundingClientRect().top -
        messageList.getBoundingClientRect().top - anchorOffset;
    }
  }
  function onConversationScroll() {
    if (!conversationList) return;
    conversationStart = Math.max(0, Math.floor(conversationList.scrollTop / conversationHeight) - 5);
    conversationEnd = Math.min(snapshot.conversations.length,
      Math.ceil((conversationList.scrollTop + conversationList.clientHeight) / conversationHeight) + 6);
    if (conversationList.scrollTop + conversationList.clientHeight >= conversationList.scrollHeight - 120) {
      void ligoState.loadMoreConversations();
    }
  }
  function avatar(username: string): string { return username.slice(0, 2).toUpperCase(); }
  function time(value: number): string {
    const date = new Date(value);
    return date.toDateString() === new Date().toDateString()
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function fileUrl(attachment: LigoAttachment): string {
    return ligoAttachmentUrls.get(attachment);
  }
  function rememberImageDimensions(event: Event, attachmentId: string): void {
    const image = event.currentTarget as HTMLImageElement;
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    imageDimensions.set(attachmentId, {
      height: image.naturalHeight,
      width: image.naturalWidth,
    });
  }
  function openImagePreview(event: MouseEvent, attachment: LigoAttachment): void {
    const image = (event.currentTarget as HTMLElement).querySelector('img');
    const dimensions = image && image.naturalWidth > 0 && image.naturalHeight > 0
      ? { height: image.naturalHeight, width: image.naturalWidth }
      : imageDimensions.get(attachment.id) ?? null;
    previewImageDimensions = dimensions;
    previewImage = attachment;
  }
  function closeImagePreview(): void {
    previewImage = null;
    previewImageDimensions = null;
  }
  function fileReady(attachment: LigoAttachment): boolean {
    return attachment.blob instanceof Blob && attachment.blob.size === attachment.size &&
      (typeof File === 'undefined' || !(attachment.blob instanceof File));
  }
  function isMediaAttachment(attachment: LigoAttachment): boolean {
    return attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/');
  }
  function isMine(message: LigoMessage): boolean { return message.senderId !== snapshot.activeUser?.id; }
  function statusMark(message: LigoMessage): string {
    if (message.status === 'read') return '✓✓';
    if (message.status === 'delivered') return '✓';
    if (message.status === 'queued') return '○';
    if (message.status === 'failed') return '!';
    return '…';
  }
  function statusTitle(message: LigoMessage): string {
    if (message.status === 'read') return 'Read';
    if (message.status === 'delivered') return 'Delivered to the recipient device';
    if (message.status === 'queued') return 'Stored on your Nodo';
    if (message.status === 'failed') return 'Could not send';
    return 'Sending';
  }
  function openMessageMenu(event: MouseEvent, message: LigoMessage): void {
    if (!isMine(message) || message.status === 'sending') return;
    openContextMenu(event, 'Message', [{
      action: async () => { await ligoState.deleteMessage(message.id); },
      confirmation: 'Delete this message for everyone? This cannot be undone.',
      danger: true,
      icon: 'delete',
      id: 'delete-ligo-message',
      label: 'Delete for everyone',
    }]);
  }
  function openConversationMenu(event: MouseEvent, user: LigoUser): void {
    openContextMenu(event, user.username, [{
      action: async () => { await ligoState.deleteConversation(user); },
      confirmation: `Delete the entire conversation with ${user.username} for both people? All local and Nodo copies will be removed.`,
      danger: true,
      icon: 'delete',
      id: 'delete-ligo-conversation',
      label: 'Delete for both',
    }]);
  }
  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB']; let value = bytes; let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }
</script>

<main class="ligo-shell" aria-label="Ligo messenger">
  <aside class="conversation-panel">
    <header class="conversation-header">
      <div class="title-row">
        <div><span>DIRECT MESSAGES</span><h1>Ligo</h1></div>
        <div class="title-actions">
          {#if snapshot.syncing}<LoadingSpinner compact />{/if}
          <button class="storage-button" type="button" aria-label="Open message storage"
            title="Message cloud" disabled={snapshot.phase === 'loading'} onclick={() => {
              storageOpen = true;
              void ligoState.refreshStorage();
            }}>
            <svg viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="4.5" width="20" height="19" rx="3"/><circle cx="10" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M8 21l2-5h8l2 5M10 12h8"/></svg>
            <i style={`--stack-fill:${Math.min(100,snapshot.stackUsedBytes/Math.max(1,snapshot.stackLimitBytes)*100)}%`}></i>
          </button>
          <span class="storage-node-name" title={`Selected storage Nodo: ${selectedNodeName}`}>{selectedNodeName}</span>
        </div>
      </div>
      <label class="search-box">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.7 12.7 4 4"/></svg>
        <input value={snapshot.searchQuery} oninput={updateSearch} placeholder="Search by username" aria-label="Search users" />
        {#if snapshot.searchPhase === 'loading'}<LoadingSpinner compact />{/if}
      </label>
    </header>

    <div bind:this={conversationList} class="conversation-list" onscroll={onConversationScroll}>
      {#if snapshot.searchQuery.trim()}
        <div class="list-label">People</div>
        {#each snapshot.searchResults as user (user.id)}
          <button class="conversation" type="button" onclick={() => open(user)}>
            <span class="avatar">{avatar(user.username)}<i class:online={user.online}></i></span>
            <span class="conversation-copy"><strong>{user.username}</strong><small>{user.online ? 'Online' : 'Send a message'}</small></span>
          </button>
        {:else}
          {#if snapshot.searchPhase === 'ready'}<p class="empty-list">No matching users</p>{/if}
        {/each}
      {:else}
        <div class="virtual-spacer" style={`height:${conversationStart * conversationHeight}px`}></div>
        {#each visibleConversations as conversation (conversation.user.id)}
          <button class="conversation" class:active={snapshot.activeUser?.id === conversation.user.id}
            type="button" onclick={() => selectConversation(conversation)}
            oncontextmenu={(event) => openConversationMenu(event, conversation.user)}>
            <span class="avatar">{avatar(conversation.user.username)}<i class:online={conversation.user.online}></i></span>
            <span class="conversation-copy">
              <span><strong>{conversation.user.username}</strong><time>{time(conversation.lastMessage.sentAt)}</time></span>
              <small>{conversation.lastMessage.mine ? 'You: ' : ''}{conversation.lastMessage.preview}</small>
            </span>
          </button>
        {:else}
          {#if snapshot.phase === 'loading'}<div class="loading-list"><LoadingSpinner compact /><span>Loading conversations…</span></div>
          {:else}<p class="empty-list">Search for someone to start a private conversation.</p>{/if}
        {/each}
        <div class="virtual-spacer" style={`height:${Math.max(0, (snapshot.conversations.length - conversationEnd) * conversationHeight)}px`}></div>
        {#if snapshot.loadingMoreConversations}<div class="loading-list"><LoadingSpinner compact /><span>Loading more…</span></div>{/if}
      {/if}
    </div>
  </aside>

  <section class="chat-panel">
    {#if snapshot.activeUser}
      <header class="chat-header">
        <span class="avatar avatar--small">{avatar(snapshot.activeUser.username)}<i class:online={snapshot.activeUser.online}></i></span>
        <div><strong>{snapshot.activeUser.username}</strong><small>{snapshot.activeUser.online ? 'Online now' : 'Messages will wait safely on your Nodo'}</small></div>
        <div class="chat-actions">
          <button class="local-files" type="button" disabled={snapshot.openingLocalFiles}
            onclick={() => void ligoState.openLocalFiles()} aria-label="Open local chat files"
            title="Open all local files from this chat">
            {#if snapshot.openingLocalFiles}<LoadingSpinner compact />{:else}
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 5.4h5l1.7 2h7.7v8.3H2.8z"/><path d="M2.8 7.4v-3h5l1.6 1.8"/></svg>
            {/if}
          </button>
          <span class="route-state" class:unavailable={!destinationReady}>{destinationReady ? 'Nodo ready' : 'Nodo unavailable'}</span>
        </div>
      </header>

      <div bind:this={messageList} class="message-list" onscroll={onScroll}>
        {#if snapshot.loadingOlder || snapshot.loadingHistory}<div class="history-loader"><LoadingSpinner compact /> {snapshot.loadingHistory ? 'Checking message clouds' : 'Loading older messages'}</div>{/if}
        {#if !snapshot.messages.length}<div class="chat-empty">
          <span class="avatar avatar--hero">{avatar(snapshot.activeUser.username)}</span>
          <h2>Start a conversation with {snapshot.activeUser.username}</h2>
          <p>Messages are kept locally on both devices. Nodo only holds a message while delivery is pending.</p>
        </div>{:else}
          <div class="message-track" style={`height:${virtualMessageHeight}px`}>
            {#each virtualMessages as row (row.key)}
              {@const message = snapshot.messages[row.index]}
              {#if message}
                <div class="virtual-message" data-index={row.index} data-message-id={message.id}
                  style={`transform:translateY(${row.start}px)`} use:measureMessage>
                  <div class="message-slot" class:mine={isMine(message)}>
                    <article class="message" class:media-message={message.attachments.some((attachment) =>
                        attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/'))}
                      class:sending={message.status === 'sending'}
                      class:failed={message.status === 'failed'}
                      oncontextmenu={(event) => openMessageMenu(event, message)}>
                      {#if message.attachments.length}<div class="message-files">
                        {#each message.attachments as attachment (attachment.id)}
                          {#if !fileReady(attachment)}
                            <div class="restoring-file" class:restoring-media={isMediaAttachment(attachment)} aria-live="polite">
                              <LoadingSpinner compact />
                              <span><strong>{attachment.name}</strong><small>Restoring local file…</small></span>
                            </div>
                          {:else if attachment.mimeType.startsWith('image/')}
                            <button class="image-file" type="button" onclick={(event) => openImagePreview(event, attachment)}
                              title="Open image" aria-label={`Open ${attachment.name}`}>
                              <img src={fileUrl(attachment)} alt={attachment.name}
                                onload={(event) => rememberImageDimensions(event, attachment.id)} />
                            </button>
                          {:else if attachment.mimeType.startsWith('video/')}
                            <LigoVideoPlayer {attachment} />
                          {:else if attachment.mimeType.startsWith('audio/')}
                            <div class="audio-file"><strong>{attachment.name}</strong><audio src={fileUrl(attachment)} controls></audio></div>
                          {:else}
                            <a class="generic-file" href={fileUrl(attachment)} download={attachment.name}>
                              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.5v4h4"/></svg>
                              <span><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></span>
                            </a>
                          {/if}
                        {/each}
                      </div>{/if}
                      {#if message.body}<p>{message.body}</p>{/if}
                      <footer><time>{time(message.createdAt)}</time>{#if isMine(message)}<span title={statusTitle(message)}>{statusMark(message)}</span>{/if}</footer>
                    </article>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <div class="composer-wrap">
        {#if snapshot.error}<p class="error" role="alert">{snapshot.error}</p>{/if}
        {#if snapshot.draftFiles.length}<div class="draft-files">
          {#each snapshot.draftFiles as file (file.id)}
            <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small><button type="button" onclick={() => ligoState.removeFile(file.id)} aria-label={`Remove ${file.name}`}>×</button></span>
          {/each}
        </div>{/if}
        {#if snapshot.uploadProgress}<div class="upload"><span>Uploading {snapshot.uploadProgress.file}</span><strong>{progress}%</strong><i><b style={`width:${progress}%`}></b></i></div>{/if}
        <div class="composer">
          <input bind:this={fileInput} type="file" multiple onchange={attach} />
          <button class="attach" type="button" onclick={() => fileInput?.click()} title="Attach files">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 10.8 4.7-4.7a2.5 2.5 0 0 1 3.6 3.6l-6.1 6.1a4 4 0 0 1-5.7-5.7l6-6"/></svg>
          </button>
          <textarea
            bind:this={composer}
            bind:value={() => snapshot.draft, (draft) => ligoState.setDraft(draft)}
            oninput={resizeDraft}
            onkeydown={keydown}
            maxlength="16000" rows="1" wrap="soft" placeholder="Write a message…"></textarea>
          <button class="send" type="button" onclick={send} disabled={!destinationReady || (!snapshot.draft.trim() && !snapshot.draftFiles.length)} aria-label="Send message">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 4 14 6-14 6 2-6z"/><path d="M5 10h8"/></svg>
          </button>
        </div>
        <small class="composer-hint">Enter to send · Shift + Enter for a new line</small>
      </div>
    {:else}
      <div class="welcome">
        <div class="welcome-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7h22v15H12l-7 5z"/><path d="M10 12h12M10 17h8"/></svg></div>
        <h2>Your private conversations</h2>
        <p>Choose a chat or find someone by username. A person appears in your list only after the first message.</p>
      </div>
    {/if}
  </section>
</main>

{#if storageOpen}
  <LigoStorageDialog
    busy={snapshot.storageSaving}
    nodes={snapshot.nodes}
    onClose={() => { if (!snapshot.storageSaving) storageOpen = false; }}
    onSave={(nodeId, bytes) => ligoState.saveStorage(nodeId, bytes)}
    publicStorage={snapshot.publicStorage}
    selectedNodeId={snapshot.selectedNodeId}
    stackLimitBytes={snapshot.stackLimitBytes}
    stackUsedBytes={snapshot.stackUsedBytes}
  />
{/if}

{#if previewImage}
  <PhotoViewer
    alt={previewImage.name}
    height={previewImageDimensions?.height}
    name={previewImage.name}
    onClose={closeImagePreview}
    url={fileUrl(previewImage)}
    width={previewImageDimensions?.width}
  />
{/if}

<style>
  /* Keep Ligo on the same SoftUI surface language as Fluo.  The palette is
     scoped to the messenger so legacy global tokens cannot flatten its depth. */
  .ligo-shell {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --ligo-shadow-color: rgb(39 51 67 / 20%);
    --sui-shadow-light: transparent !important;
    --sui-shadow-dark: var(--ligo-shadow-color) !important;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #d03a5c;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-radius-sm: 10px;
    --sui-radius: 16px;
    --sui-radius-lg: 24px;
    --sui-shadow-raised: 0 5px 14px var(--ligo-shadow-color) !important;
    --sui-shadow-raised-sm: 0 3px 8px var(--ligo-shadow-color) !important;
    --sui-shadow-raised-lg: 0 16px 36px var(--ligo-shadow-color) !important;
    --sui-shadow-inset: inset 3px 3px 8px var(--sui-shadow-dark);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-dark);
    display: grid;
    grid-template-columns: minmax(252px, 304px) minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--sui-text);
    background: var(--sui-bg);
    isolation: isolate;
  }

  :global(html[data-theme='dark']) .ligo-shell {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --ligo-shadow-color: rgb(0 0 0 / 42%);
    --sui-shadow-dark: var(--ligo-shadow-color) !important;
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-text: #e2e8f0;
    --sui-text-muted: #9ba5b8;
    --sui-text-light: #8a94a6;
  }

  .conversation-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    padding: 14px;
    background: var(--sui-bg);
    box-shadow: inset -1px 0 0 color-mix(in srgb, var(--sui-shadow-dark) 20%, transparent);
  }

  .conversation-header {
    display: grid;
    gap: 14px;
    padding: 11px 8px 15px;
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .title-row span,
  .list-label {
    color: var(--sui-text-light);
    font-size: calc(9px * var(--text-scale));
    font-weight: 760;
    letter-spacing: .13em;
  }

  .title-row h1 {
    margin: 4px 0 0;
    color: var(--sui-text);
    font-size: calc(25px * var(--text-scale));
    letter-spacing: -.045em;
  }

  .title-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .storage-button,
  .local-files,
  .composer button,
  .draft-files button {
    transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .storage-button {
    position: relative;
    display: grid;
    width: 42px;
    height: 42px;
    padding: 0;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: var(--sui-radius-sm);
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    place-items: center;
  }

  .storage-button:hover:not(:disabled) {
    color: var(--sui-primary-hover);
    transform: translateY(-1px);
  }

  .storage-button:active:not(:disabled) {
    box-shadow: var(--sui-shadow-inset-sm);
    transform: translateY(0);
  }

  .storage-button:disabled {
    cursor: default;
    opacity: .45;
  }

  .storage-button svg {
    width: 24px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.45;
  }

  .storage-button i {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 7px;
    height: 7px;
    background: conic-gradient(var(--sui-success) var(--stack-fill), color-mix(in srgb, var(--sui-text-light) 22%, transparent) 0);
    border: 1px solid var(--sui-bg);
    border-radius: 50%;
  }

  .storage-node-name {
    max-width: 116px;
    overflow: hidden;
    color: var(--sui-primary);
    font-size: calc(9px * var(--text-scale));
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 40px;
    padding: 0 13px;
    color: var(--sui-text-muted);
    background: var(--sui-bg);
    border: 0;
    border-radius: var(--sui-radius-sm);
    box-shadow: var(--sui-shadow-inset-sm);
  }

  .search-box:focus-within {
    color: var(--sui-primary);
    box-shadow: var(--sui-shadow-inset-sm), 0 0 0 2px color-mix(in srgb, var(--sui-primary) 22%, transparent);
  }

  .search-box svg {
    width: 17px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.6;
  }

  .search-box input {
    min-width: 0;
    flex: 1;
    color: var(--sui-text);
    background: none;
    border: 0;
    outline: 0;
    font: inherit;
    font-size: calc(11px * var(--text-scale));
  }

  .conversation-list {
    min-height: 0;
    overflow: auto;
    padding: 5px 2px 8px;
    scrollbar-color: color-mix(in srgb, var(--sui-text-light) 48%, transparent) transparent;
    scrollbar-width: thin;
  }

  .list-label { padding: 7px 11px 8px; }

  .conversation {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    min-height: 66px;
    padding: 10px;
    color: var(--sui-text);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--sui-radius-sm);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .conversation:hover {
    background: color-mix(in srgb, var(--sui-bg-light) 55%, transparent);
    box-shadow: var(--sui-shadow-raised-sm);
    transform: translateY(-1px);
  }

  .conversation:active,
  .conversation.active {
    background: var(--sui-bg);
    box-shadow: var(--sui-shadow-inset-sm);
    transform: translateY(0);
  }

  .virtual-spacer { width: 1px; pointer-events: none; }

  .avatar {
    position: relative;
    display: grid;
    flex: none;
    width: 44px;
    height: 44px;
    color: #fff;
    background: linear-gradient(145deg, var(--sui-primary), color-mix(in srgb, var(--sui-primary) 64%, #20263e));
    border-radius: 14px;
    box-shadow: var(--sui-shadow-raised-sm);
    font-size: calc(12px * var(--text-scale));
    font-weight: 760;
    place-items: center;
  }

  .avatar i {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 10px;
    height: 10px;
    background: var(--sui-text-light);
    border: 2px solid var(--sui-bg);
    border-radius: 50%;
  }

  .avatar i.online { background: var(--sui-success); }

  .conversation-copy {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 4px;
  }

  .conversation-copy > span { display: flex; align-items: center; gap: 8px; }
  .conversation-copy strong { overflow: hidden; flex: 1; font-size: calc(12px * var(--text-scale)); text-overflow: ellipsis; }
  .conversation-copy time { color: var(--sui-text-light); font-size: calc(9px * var(--text-scale)); }
  .conversation-copy small { overflow: hidden; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .empty-list { padding: 22px 12px; color: var(--sui-text-muted); font-size: calc(11px * var(--text-scale)); line-height: 1.55; }
  .loading-list { display: flex; align-items: center; gap: 10px; padding: 24px 12px; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }

  .chat-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: radial-gradient(circle at 92% 0, color-mix(in srgb, var(--sui-primary) 9%, transparent), transparent 35%), var(--sui-bg);
  }

  .chat-header {
    display: flex;
    align-items: center;
    gap: 11px;
    min-height: 70px;
    padding: 0 clamp(18px, 3vw, 32px);
    color: var(--sui-text);
    background: var(--sui-bg);
    box-shadow: 0 3px 10px color-mix(in srgb, var(--sui-shadow-dark) 50%, transparent);
    z-index: 2;
  }

  .avatar--small { width: 38px; height: 38px; border-radius: 12px; }
  .chat-header > div { display: grid; gap: 2px; }
  .chat-header strong { font-size: calc(13px * var(--text-scale)); }
  .chat-header small { color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }
  .chat-header .chat-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }

  .local-files {
    display: grid;
    width: 34px;
    height: 34px;
    padding: 0;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 11px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    place-items: center;
  }

  .local-files:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .local-files:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(0); }
  .local-files:disabled { cursor: default; opacity: .65; }
  .local-files svg { width: 18px; fill: color-mix(in srgb, var(--sui-primary) 12%, transparent); stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .route-state { color: var(--sui-success); font-size: calc(10px * var(--text-scale)); font-weight: 700; }
  .route-state.unavailable { color: var(--sui-danger); }

  .message-list {
    position: relative;
    min-height: 0;
    height: 100%;
    overflow: auto;
    overflow-anchor: none;
    overscroll-behavior: contain;
    scroll-behavior: auto;
    contain: layout paint style;
    isolation: isolate;
    scrollbar-color: color-mix(in srgb, var(--sui-text-light) 48%, transparent) transparent;
    scrollbar-width: thin;
  }

  .message-track { position: relative; width: 100%; min-height: 1px; overflow-anchor: none; }
  .virtual-message { position: absolute; top: 0; left: 0; width: 100%; padding-inline: clamp(18px, 5vw, 72px); contain: layout paint style; }

  .history-loader {
    position: sticky;
    z-index: 3;
    top: 10px;
    display: flex;
    width: max-content;
    align-items: center;
    gap: 8px;
    margin: 10px auto -42px;
    padding: 8px 12px;
    color: var(--sui-text-muted);
    background: var(--sui-bg);
    border-radius: 999px;
    box-shadow: var(--sui-shadow-raised-sm);
    font-size: calc(10px * var(--text-scale));
  }

  .chat-empty { display: grid; min-height: 100%; padding: 24px; place-content: center; text-align: center; }
  .chat-empty > * { justify-self: center; }
  .chat-empty p { max-width: 430px; }
  .avatar--hero { width: 68px; height: 68px; margin: 0 auto 16px; border-radius: 22px; font-size: calc(18px * var(--text-scale)); }
  .chat-empty h2, .welcome h2 { margin: 0 0 8px; color: var(--sui-text); font-size: calc(20px * var(--text-scale)); letter-spacing: -.025em; }
  .chat-empty p, .welcome p { margin: 0; color: var(--sui-text-muted); font-size: calc(12px * var(--text-scale)); line-height: 1.6; }

  .message-slot { display: flex; flex: 0 0 auto; min-width: 0; width: 100%; align-items: flex-start; justify-content: flex-start; }
  .message-slot.mine { justify-content: flex-end; }

  .message {
    box-sizing: border-box;
    min-width: 0;
    max-width: min(70%, 680px);
    padding: 10px 13px 7px;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: 7px 17px 17px 17px;
    box-shadow: var(--sui-shadow-raised);
    transition: opacity 150ms ease, box-shadow 150ms ease, transform 150ms ease;
  }

  .message.media-message { width: min(70%, 584px); padding: 6px 6px 7px; }
  .message-slot.mine .message { background: color-mix(in srgb, var(--sui-primary) 11%, var(--sui-bg)); border-radius: 17px 7px 17px 17px; }
  .message.sending { opacity: .48; }
  .message.failed { box-shadow: 0 5px 14px color-mix(in srgb, var(--sui-danger) 26%, transparent); opacity: .78; }
  .message p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; font-size: calc(13px * var(--text-scale)); line-height: 1.48; }
  .message.media-message > p { padding: 3px 7px 0; }
  .message footer { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 4px; color: var(--sui-text-light); font-size: calc(9px * var(--text-scale)); }
  .message.media-message > footer { padding-inline: 6px; }
  .message-slot.mine footer span { color: var(--sui-primary); font-weight: 800; letter-spacing: -.12em; }
  .message.failed footer span { color: var(--sui-danger); }

  .message-files { display: grid; gap: 6px; max-width: 100%; margin-bottom: 7px; }
  .message-files img { display: block; max-width: 100%; max-height: 380px; border-radius: 11px; background: #11131a; object-fit: contain; }
  .image-file { display: block; max-width: 100%; padding: 0; background: transparent; border: 0; border-radius: 11px; cursor: zoom-in; overflow: hidden; }
  .image-file img { transition: transform 180ms ease, filter 180ms ease; }
  .image-file:hover img { filter: brightness(.94); transform: scale(1.012); }
  .image-file:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: 2px; }
  .generic-file, .restoring-file { display: flex; align-items: center; gap: 9px; min-width: 220px; padding: 9px; color: inherit; text-decoration: none; background: color-mix(in srgb, var(--sui-bg-dark) 50%, var(--sui-bg)); border-radius: 11px; }
  .restoring-file.restoring-media { width: 100%; min-width: 0; min-height: 148px; aspect-ratio: 16 / 9; justify-content: center; padding: 16px; }
  .generic-file svg { width: 28px; fill: none; stroke: var(--sui-primary); stroke-width: 1.4; }
  .generic-file span, .audio-file, .restoring-file span { display: grid; gap: 2px; min-width: 0; }
  .generic-file strong, .audio-file strong, .restoring-file strong { overflow: hidden; max-width: 360px; font-size: calc(11px * var(--text-scale)); text-overflow: ellipsis; }
  .generic-file small, .restoring-file small { color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); }
  .audio-file audio { display: block; width: min(100%, 360px); max-width: 100%; height: 34px; }

  .composer-wrap { padding: 10px clamp(18px, 4vw, 58px) 16px; }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 7px;
    padding: 8px;
    background: var(--sui-bg);
    border: 0;
    border-radius: var(--sui-radius);
    box-shadow: var(--sui-shadow-raised);
  }

  .composer input { display: none; }
  .composer textarea { min-width: 0; flex: 1; min-height: 22px; max-height: 148px; padding: 6px 3px; overflow-x: hidden; overflow-y: auto; resize: none; white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: none; color: var(--sui-text); background: transparent; border: 0; outline: 0; font: inherit; font-size: calc(13px * var(--text-scale)); line-height: 1.45; }
  .composer textarea::-webkit-scrollbar { display: none; width: 0; height: 0; }
  .composer button { display: grid; flex: none; width: 36px; height: 36px; border: 0; border-radius: 11px; cursor: pointer; place-items: center; }
  .composer button:disabled { cursor: default; opacity: .4; }
  .composer svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
  .attach { color: var(--sui-text-muted); background: transparent; }
  .attach:hover:not(:disabled) { color: var(--sui-primary); background: color-mix(in srgb, var(--sui-primary) 8%, transparent); }
  .send { color: #fff; background: var(--sui-primary); box-shadow: var(--sui-shadow-raised-sm); }
  .send:hover:not(:disabled) { background: var(--sui-primary-hover); transform: translateY(-1px); }
  .send:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(0); }
  .send svg { fill: currentColor; stroke: currentColor; }
  .composer-hint { display: block; margin: 6px 7px 0; color: var(--sui-text-light); font-size: calc(9px * var(--text-scale)); }

  .draft-files { display: flex; gap: 7px; overflow: auto; padding: 0 2px 8px; }
  .draft-files > span { display: flex; align-items: center; gap: 7px; max-width: 250px; padding: 7px 9px; color: var(--sui-text); background: var(--sui-bg); border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); }
  .draft-files strong { overflow: hidden; font-size: calc(10px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .draft-files small { flex: none; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); }
  .draft-files button { display: grid; width: 20px; height: 20px; padding: 0; color: var(--sui-text-muted); background: transparent; border: 0; border-radius: 6px; cursor: pointer; place-items: center; }
  .draft-files button:hover { color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, transparent); }
  .draft-files button:active { box-shadow: var(--sui-shadow-inset-sm); }
  .upload { display: grid; grid-template-columns: 1fr auto; gap: 5px; margin-bottom: 8px; padding: 9px 12px; color: var(--sui-primary); background: color-mix(in srgb, var(--sui-primary) 8%, var(--sui-bg)); border-radius: 11px; font-size: calc(10px * var(--text-scale)); }
  .upload i { grid-column: 1 / -1; height: 4px; overflow: hidden; background: color-mix(in srgb, var(--sui-primary) 14%, transparent); border-radius: 999px; }
  .upload b { display: block; height: 100%; background: var(--sui-primary); border-radius: inherit; }
  .error { margin: 0 0 8px; padding: 9px 11px; color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); border-radius: 10px; font-size: calc(10px * var(--text-scale)); }

  .welcome { align-self: center; justify-self: center; max-width: 420px; padding: 34px; text-align: center; }
  .welcome-mark { display: grid; width: 72px; height: 72px; margin: 0 auto 19px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 22px; box-shadow: var(--sui-shadow-raised); place-items: center; }
  .welcome-mark svg { width: 35px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }

  button:focus-visible,
  input:focus-visible,
  textarea:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 72%, transparent); outline-offset: 2px; }

  @media (max-width: 760px) {
    .ligo-shell { grid-template-columns: 236px minmax(0, 1fr); }
    .conversation-panel { padding-inline: 9px; }
    .conversation-header { padding-inline: 6px; }
    .message { max-width: 88%; }
    .message.media-message { width: 88%; }
    .virtual-message { padding-inline: 16px; }
    .chat-header { padding-inline: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .storage-button,
    .local-files,
    .composer button,
    .conversation,
    .draft-files button,
    .image-file img { transition: none; }
  }
</style>
