<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { LigoAttachment, LigoConversation, LigoMessage, LigoUser } from '../../lib/domain/ligo';
  import { PUBLIC_LIGO_DESTINATION } from '../../lib/gateways/NodeLigoTransport';
  import { ligoAttachmentUrls } from '../../lib/services/LigoAttachmentUrls';
  import type { LigoGState, LigoSnapshot } from '../../lib/states/LigoGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import LigoImageViewer from './LigoImageViewer.svelte';
  import LigoStorageDialog from './LigoStorageDialog.svelte';
  import LigoVideoPlayer from './LigoVideoPlayer.svelte';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = { snapshot: Readonly<LigoSnapshot>; state: LigoGState };
  let { snapshot, state: ligoState }: Props = $props();
  let fileInput = $state<HTMLInputElement>();
  let composer = $state<HTMLTextAreaElement>();
  let messageList = $state<HTMLElement>();
  let conversationList = $state<HTMLElement>();
  let conversationStart = $state(0);
  let conversationEnd = $state(24);
  let storageOpen = $state(false);
  let previewImage = $state<LigoAttachment | null>(null);
  let latestMessageId = '';
  let restoringUserId = $state<string | null>(null);
  let initialRestore = $state(true);
  const conversationHeight = 62;
  let visibleConversations = $derived(snapshot.conversations.slice(conversationStart, conversationEnd));
  let publicAvailable = $derived(Boolean(snapshot.publicStorage?.nodeCandidates.length));
  let selectedPrivate = $derived(snapshot.nodes.find(({ id }) => id === snapshot.selectedNodeId));
  let destinationReady = $derived(snapshot.selectedNodeId === PUBLIC_LIGO_DESTINATION
    ? publicAvailable : Boolean(selectedPrivate?.online && selectedPrivate.policy.allowUploads));
  let progress = $derived(snapshot.uploadProgress ? Math.round(snapshot.uploadProgress.uploadedBytes /
    Math.max(1, snapshot.uploadProgress.totalBytes) * 100) : 0);

  onMount(() => {
    latestMessageId = snapshot.messages.at(-1)?.id ?? '';
    restoringUserId = snapshot.activeUser?.id ?? null;
    initialRestore = false;
    if (restoringUserId) void restoreScroll(restoringUserId);
  });
  onDestroy(rememberScroll);

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
    messageList.scrollTop = messageList.scrollHeight;
    rememberScroll();
  }
  function rememberScroll() {
    const userId = snapshot.activeUser?.id;
    if (!messageList || !userId || restoringUserId === userId) return;
    const viewport = messageList.getBoundingClientRect();
    const messages = [...messageList.querySelectorAll<HTMLElement>('[data-message-id]')];
    const anchor = messages.find((message) => message.getBoundingClientRect().bottom > viewport.top + 1) ?? null;
    ligoState.rememberScroll(userId, {
      atBottom: messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 4,
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
      messageList.scrollTop = messageList.scrollHeight;
    } else {
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
  function stabilizeMessage(node: HTMLElement, messageId: string) {
    let layoutKey = messageLayoutKey();
    const reserve = () => {
      const height = ligoState.rememberedMessageHeight(messageId, layoutKey);
      node.style.minHeight = height ? `${height}px` : '';
    };
    reserve();
    let previousHeight = node.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const nextLayoutKey = messageLayoutKey();
      if (nextLayoutKey !== layoutKey) {
        layoutKey = nextLayoutKey;
        reserve();
        previousHeight = node.getBoundingClientRect().height;
        return;
      }
      const nextHeight = node.getBoundingClientRect().height;
      const delta = nextHeight - previousHeight;
      if (Math.abs(delta) < 0.5) return;
      const list = messageList;
      const aboveViewport = Boolean(list && node.getBoundingClientRect().top < list.getBoundingClientRect().top);
      previousHeight = nextHeight;
      ligoState.rememberMessageHeight(messageId, layoutKey, nextHeight);
      node.style.minHeight = `${ligoState.rememberedMessageHeight(messageId, layoutKey) ?? nextHeight}px`;
      if (list && aboveViewport && restoringUserId !== snapshot.activeUser?.id) list.scrollTop += delta;
    });
    observer.observe(node);
    ligoState.rememberMessageHeight(messageId, layoutKey, previousHeight);
    return { destroy: () => observer.disconnect() };
  }
  function messageLayoutKey(): string {
    const textScale = typeof document === 'undefined'
      ? '1'
      : getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim() || '1';
    return `${Math.round(messageList?.clientWidth ?? 0)}:${textScale}:${globalThis.devicePixelRatio ?? 1}`;
  }
  async function onScroll() {
    rememberScroll();
    if (!messageList || messageList.scrollTop > 100 || !snapshot.hasOlder || snapshot.loadingOlder) return;
    const previousHeight = messageList.scrollHeight;
    await ligoState.loadOlder();
    await tick();
    messageList.scrollTop += messageList.scrollHeight - previousHeight;
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
  function fileReady(attachment: LigoAttachment): boolean {
    return attachment.blob instanceof Blob && attachment.blob.size === attachment.size &&
      (typeof File === 'undefined' || !(attachment.blob instanceof File));
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

      <div bind:this={messageList} class="message-list"
        class:restoring={initialRestore || restoringUserId === snapshot.activeUser.id} onscroll={onScroll}>
        {#if snapshot.loadingOlder || snapshot.loadingHistory}<div class="history-loader"><LoadingSpinner compact /> {snapshot.loadingHistory ? 'Checking message clouds' : 'Loading older messages'}</div>{/if}
        {#if !snapshot.messages.length}<div class="chat-empty">
          <span class="avatar avatar--hero">{avatar(snapshot.activeUser.username)}</span>
          <h2>Start a conversation with {snapshot.activeUser.username}</h2>
          <p>Messages are kept locally on both devices. Nodo only holds a message while delivery is pending.</p>
        </div>{/if}
        {#each snapshot.messages as message (message.id)}
          <div class="message-slot" class:mine={isMine(message)} data-message-id={message.id}
            use:stabilizeMessage={message.id}>
            <article class="message" class:media-message={message.attachments.some((attachment) =>
                attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/'))}
              class:sending={message.status === 'sending'}
              class:failed={message.status === 'failed'}
              oncontextmenu={(event) => openMessageMenu(event, message)}>
              {#if message.attachments.length}<div class="message-files">
                {#each message.attachments as attachment (attachment.id)}
                  {#if !fileReady(attachment)}
                    <div class="restoring-file" aria-live="polite">
                      <LoadingSpinner compact />
                      <span><strong>{attachment.name}</strong><small>Restoring local file…</small></span>
                    </div>
                  {:else if attachment.mimeType.startsWith('image/')}
                    <button class="image-file" type="button" onclick={() => { previewImage = attachment; }}
                      title="Open image" aria-label={`Open ${attachment.name}`}>
                      <img src={fileUrl(attachment)} alt={attachment.name} />
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
        {/each}
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
  <LigoImageViewer attachment={previewImage} url={fileUrl(previewImage)} onClose={() => { previewImage = null; }} />
{/if}

<style>
  .ligo-shell{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);min-width:0;min-height:0;background:var(--canvas);color:var(--ink)}
  .conversation-panel{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;border-right:1px solid var(--line);background:color-mix(in srgb,var(--panel) 94%,var(--accent) 6%)}
  .conversation-header{display:grid;gap:14px;padding:22px 18px 16px;border-bottom:1px solid var(--line)}
  .title-row{display:flex;align-items:center;justify-content:space-between}.title-row span,.list-label{color:var(--muted);font-size:calc(10px * var(--text-scale));font-weight:700;letter-spacing:.11em}.title-row h1{margin:3px 0 0;font-size:calc(24px * var(--text-scale));letter-spacing:-.04em}.title-actions{display:flex;align-items:center;gap:9px}.storage-button{position:relative;display:grid;width:42px;height:42px;padding:0;color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 22%,var(--line));border-radius:12px;cursor:pointer;place-items:center;box-shadow:0 4px 12px rgb(20 48 39 / 6%);transition:transform 120ms ease,background 120ms ease}.storage-button:hover:not(:disabled){transform:translateY(-1px);background:color-mix(in srgb,var(--accent) 13%,var(--panel))}.storage-button:disabled{opacity:.45;cursor:default}.storage-button svg{width:25px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.45}.storage-button i{position:absolute;right:4px;bottom:4px;width:7px;height:7px;background:conic-gradient(#4cab7d var(--stack-fill),color-mix(in srgb,var(--muted) 22%,transparent) 0);border:1px solid var(--panel);border-radius:50%}
  .search-box{display:flex;align-items:center;gap:8px;height:38px;padding:0 11px;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 4px 14px rgb(25 53 43 / 4%)}.search-box:focus-within{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 11%,transparent)}.search-box svg{width:17px;fill:none;stroke:var(--muted);stroke-width:1.6}.search-box input{min-width:0;flex:1;background:none;border:0;outline:0;color:var(--ink);font:inherit;font-size:calc(12px * var(--text-scale))}
  .conversation-list{overflow:auto;padding:10px}.list-label{padding:5px 9px 8px}.conversation{display:flex;align-items:center;gap:11px;width:100%;min-height:62px;padding:8px;color:inherit;text-align:left;background:transparent;border:0;border-radius:13px;cursor:pointer}.conversation:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}.conversation.active{background:color-mix(in srgb,var(--accent) 13%,transparent)}
  .virtual-spacer{width:1px;pointer-events:none}
  .avatar{position:relative;display:grid;flex:none;width:44px;height:44px;color:white;background:linear-gradient(145deg,var(--accent),color-mix(in srgb,var(--accent) 62%,#143d35));border-radius:14px;place-items:center;font-size:calc(12px * var(--text-scale));font-weight:750;box-shadow:inset 0 0 0 1px rgb(255 255 255 / 15%)}.avatar i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;background:var(--muted);border:2px solid var(--panel);border-radius:50%}.avatar i.online{background:#3fbd83}
  .conversation-copy{display:grid;min-width:0;flex:1;gap:4px}.conversation-copy>span{display:flex;align-items:center;gap:8px}.conversation-copy strong{overflow:hidden;flex:1;font-size:calc(13px * var(--text-scale));text-overflow:ellipsis}.conversation-copy time{color:var(--muted);font-size:calc(10px * var(--text-scale))}.conversation-copy small{overflow:hidden;color:var(--muted);font-size:calc(11px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.empty-list{padding:22px 12px;color:var(--muted);font-size:calc(12px * var(--text-scale));line-height:1.55}.loading-list{display:flex;align-items:center;gap:10px;padding:24px 12px;color:var(--muted);font-size:calc(11px * var(--text-scale))}
  .chat-panel{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-width:0;min-height:0;background:radial-gradient(circle at 90% 0,color-mix(in srgb,var(--accent) 6%,transparent),transparent 36%),var(--canvas)}.chat-header{display:flex;align-items:center;gap:11px;min-height:64px;padding:0 22px;background:color-mix(in srgb,var(--panel) 88%,transparent);border-bottom:1px solid var(--line);backdrop-filter:blur(16px)}.avatar--small{width:38px;height:38px;border-radius:12px}.chat-header>div{display:grid;gap:2px}.chat-header strong{font-size:calc(13px * var(--text-scale))}.chat-header small{color:var(--muted);font-size:calc(10px * var(--text-scale))}.chat-header .chat-actions{display:flex;align-items:center;gap:9px;margin-left:auto}.local-files{display:grid;width:32px;height:32px;padding:0;color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent);border:1px solid color-mix(in srgb,var(--accent) 18%,var(--line));border-radius:10px;cursor:pointer;place-items:center;transition:background 140ms ease,border-color 140ms ease,transform 140ms ease}.local-files:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 14%,transparent);border-color:color-mix(in srgb,var(--accent) 32%,var(--line));transform:translateY(-1px)}.local-files:disabled{cursor:default;opacity:.65}.local-files svg{width:18px;fill:color-mix(in srgb,var(--accent) 12%,transparent);stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.45}.route-state{color:var(--accent);font-size:calc(10px * var(--text-scale));font-weight:650}.route-state.unavailable{color:#b45b61}
  .message-list{position:relative;display:flex;flex-direction:column;gap:6px;overflow:auto;padding:24px clamp(20px,5vw,72px);scroll-behavior:auto}.message-list.restoring{visibility:hidden}.history-loader{position:absolute;z-index:2;top:10px;left:50%;display:flex;align-items:center;gap:8px;padding:7px 11px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:999px;box-shadow:0 4px 14px rgb(20 48 39 / 8%);font-size:calc(10px * var(--text-scale));transform:translateX(-50%)}.chat-empty{margin:auto;text-align:center;max-width:430px}.avatar--hero{width:68px;height:68px;margin:0 auto 16px;border-radius:22px;font-size:calc(18px * var(--text-scale))}.chat-empty h2,.welcome h2{margin:0 0 8px;font-size:calc(20px * var(--text-scale));letter-spacing:-.025em}.chat-empty p,.welcome p{margin:0;color:var(--muted);font-size:calc(12px * var(--text-scale));line-height:1.6}
  .message-slot{display:flex;flex:0 0 auto;min-width:0;width:100%;align-items:flex-start;justify-content:flex-start}.message-slot.mine{justify-content:flex-end}.message{box-sizing:border-box;min-width:0;max-width:min(70%,680px);padding:9px 12px 6px;background:var(--panel);border:1px solid var(--line);border-radius:6px 16px 16px 16px;box-shadow:0 5px 18px rgb(20 48 39 / 5%);transition:opacity 150ms ease,border-color 150ms ease}.message.media-message{width:min(70%,584px);padding:5px 5px 6px}.message-slot.mine .message{background:color-mix(in srgb,var(--accent) 13%,var(--panel));border-color:color-mix(in srgb,var(--accent) 20%,var(--line));border-radius:16px 6px 16px 16px}.message.sending{opacity:.48}.message.failed{border-color:color-mix(in srgb,#b44b55 45%,var(--line));opacity:.72}.message p{margin:0;overflow-wrap:anywhere;white-space:pre-wrap;font-size:calc(13px * var(--text-scale));line-height:1.48}.message.media-message>p{padding:3px 7px 0}.message footer{display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-top:3px;color:var(--muted);font-size:calc(9px * var(--text-scale))}.message.media-message>footer{padding-inline:6px}.message-slot.mine footer span{color:var(--accent);font-weight:800;letter-spacing:-.12em}.message.failed footer span{color:#b44b55}
  .message-files{display:grid;gap:5px;max-width:100%;margin-bottom:7px}.message-files img{display:block;max-width:100%;max-height:380px;border-radius:10px;background:#111;object-fit:contain}.image-file{display:block;max-width:100%;padding:0;background:transparent;border:0;border-radius:10px;cursor:zoom-in;overflow:hidden}.image-file img{transition:transform 180ms ease,filter 180ms ease}.image-file:hover img{filter:brightness(.94);transform:scale(1.012)}.image-file:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.generic-file,.restoring-file{display:flex;align-items:center;gap:9px;min-width:220px;padding:8px;color:inherit;text-decoration:none;background:color-mix(in srgb,var(--canvas) 75%,transparent);border-radius:10px}.generic-file svg{width:28px;fill:none;stroke:var(--accent);stroke-width:1.4}.generic-file span,.audio-file,.restoring-file span{display:grid;gap:2px}.generic-file strong,.audio-file strong,.restoring-file strong{overflow:hidden;max-width:360px;font-size:calc(11px * var(--text-scale));text-overflow:ellipsis}.generic-file small,.restoring-file small{color:var(--muted);font-size:calc(9px * var(--text-scale))}.audio-file audio{max-width:360px;height:34px}
  .composer-wrap{padding:8px clamp(18px,4vw,58px) 16px}.composer{display:flex;align-items:flex-end;gap:7px;padding:7px;background:var(--panel);border:1px solid var(--line-strong);border-radius:16px;box-shadow:0 10px 28px rgb(20 48 39 / 8%)}.composer input{display:none}.composer textarea{min-width:0;flex:1;min-height:22px;max-height:148px;padding:6px 3px;overflow-x:hidden;overflow-y:auto;resize:none;white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:none;color:var(--ink);background:transparent;border:0;outline:0;font:inherit;font-size:calc(13px * var(--text-scale));line-height:1.45}.composer textarea::-webkit-scrollbar{display:none;width:0;height:0}.composer button{display:grid;flex:none;width:34px;height:34px;border:0;border-radius:11px;cursor:pointer;place-items:center}.composer button:disabled{cursor:default;opacity:.4}.composer svg{width:18px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.7}.attach{color:var(--muted);background:transparent}.attach:hover{color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}.send{color:white;background:var(--accent)}.send svg{fill:currentColor;stroke:var(--accent-bright)}.composer-hint{display:block;margin:5px 6px 0;color:var(--muted);font-size:calc(9px * var(--text-scale))}
  .draft-files{display:flex;gap:6px;overflow:auto;padding:0 2px 7px}.draft-files>span{display:flex;align-items:center;gap:7px;max-width:250px;padding:7px 8px;background:var(--panel);border:1px solid var(--line);border-radius:10px}.draft-files strong{overflow:hidden;font-size:calc(10px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.draft-files small{flex:none;color:var(--muted);font-size:calc(9px * var(--text-scale))}.draft-files button{color:var(--muted);background:none;border:0;cursor:pointer}.upload{display:grid;grid-template-columns:1fr auto;gap:5px;margin-bottom:7px;padding:8px 11px;color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--panel));border-radius:10px;font-size:calc(10px * var(--text-scale))}.upload i{grid-column:1/-1;height:4px;overflow:hidden;background:color-mix(in srgb,var(--accent) 14%,transparent);border-radius:999px}.upload b{display:block;height:100%;background:var(--accent);border-radius:inherit}.error{margin:0 0 7px;padding:8px 10px;color:#a1454c;background:rgb(180 70 78 / 9%);border-radius:9px;font-size:calc(10px * var(--text-scale))}
  .welcome{align-self:center;justify-self:center;max-width:420px;padding:30px;text-align:center}.welcome-mark{display:grid;width:68px;height:68px;margin:0 auto 18px;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 18%,var(--line));border-radius:22px;place-items:center}.welcome-mark svg{width:35px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5}
  @media(max-width:760px){.ligo-shell{grid-template-columns:240px minmax(0,1fr)}.conversation-header{padding-inline:12px}.message{max-width:88%}.message.media-message{width:88%}.message-list{padding-inline:16px}}
</style>
