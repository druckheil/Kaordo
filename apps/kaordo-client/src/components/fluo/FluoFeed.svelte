<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    FLUO_MAX_POST_LENGTH,
    FLUO_MAX_ATTACHMENTS,
    type FluoGState,
    type FluoSnapshot,
  } from '../../lib/states/FluoGState';
  import { PUBLIC_FLUO_DESTINATION } from '../../lib/gateways/FluoGateway';
  import NodoPickerDialog from '../nodo/NodoPickerDialog.svelte';
  import FluoTimeline from './FluoTimeline.svelte';

  type Props = {
    active?: boolean;
    snapshot: Readonly<FluoSnapshot>;
    fluoState: FluoGState;
  };

  let { active = true, snapshot, fluoState }: Props = $props();
  let attachmentInput = $state<HTMLInputElement>();
  let composer = $state<HTMLTextAreaElement>();
  let composerTrigger = $state<HTMLButtonElement>();
  let composerModal = $state<HTMLElement>();
  let emojiWrap = $state<HTMLDivElement>();
  let shell = $state<HTMLElement>();
  let composerOpen = $state(false);
  let emojiOpen = $state(false);
  let nodePickerOpen = $state(false);
  let mediaPreparation = Promise.resolve();
  let composerShakeAnimation: Animation | null = null;
  const EMOJI_OPTIONS = ['🙂', '😀', '😂', '😍', '😮', '😢', '🔥', '🎉', '👍', '💡', '🌿', '✨'];
  let remaining = $derived(FLUO_MAX_POST_LENGTH - snapshot.draft.length);
  let mediaCount = $derived(snapshot.draftAttachments.length);
  let selectedNode = $derived(snapshot.nodes.find(({ id }) => id === snapshot.selectedNodeId));
  let publicAvailable = $derived(Boolean(snapshot.publicStorage?.nodeCandidates.length));
  let destinationAvailable = $derived(snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION
    ? publicAvailable
    : Boolean(selectedNode?.online && selectedNode.policy.allowUploads));
  let selectedNodeName = $derived(snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION
    ? 'Public Nodo'
    : selectedNode?.deviceName ?? 'Nodo unavailable');
  let selectedNodeQuota = $derived(snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION
    ? snapshot.publicStorage?.limitBytes ?? 1_073_741_824
    : selectedNode?.spaces.private.quotaBytes ?? 0);
  let selectedNodeUsed = $derived(snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION
    ? (snapshot.publicStorage?.usedBytes ?? 0) + (snapshot.publicStorage?.reservedBytes ?? 0)
    : selectedNode?.spaces.private.usedBytes ?? 0);
  let selectedNodeFill = $derived(Math.min(100, selectedNodeUsed / Math.max(1, selectedNodeQuota) * 100));
  let uploadPercent = $derived(snapshot.uploadProgress
    ? Math.min(100, Math.round(snapshot.uploadProgress.uploadedBytes /
        Math.max(1, snapshot.uploadProgress.totalBytes) * 100))
    : 0);

  onDestroy(() => {
    composerShakeAnimation?.cancel();
  });

  function openComposer() {
    if (snapshot.isPublishing) return;
    composerOpen = true;
    emojiOpen = false;
    void tick().then(() => composer?.focus({ preventScroll: true }));
  }

  function closeComposer() {
    if (snapshot.isPublishing) return;
    composerOpen = false;
    emojiOpen = false;
    void tick().then(() => composerTrigger?.focus({ preventScroll: true }));
  }

  function handleComposerDialogKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeComposer();
  }

  function handleWindowPointerdown(event: PointerEvent) {
    if (!emojiOpen || !emojiWrap) return;
    if (event.target instanceof Node && emojiWrap.contains(event.target)) return;
    emojiOpen = false;
  }

  function handleComposerBackdropClick(event: MouseEvent) {
    if (snapshot.isPublishing || event.target !== event.currentTarget) return;
    composerShakeAnimation?.cancel();
    const animation = composerModal?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-8px)' },
        { transform: 'translateX(7px)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 360, easing: 'cubic-bezier(.36,.07,.19,.97)' },
    );
    if (!animation) return;
    composerShakeAnimation = animation;
    void animation.finished.then(() => {
      if (composerShakeAnimation === animation) composerShakeAnimation = null;
    }).catch(() => undefined);
  }

  function insertEmoji(emoji: string) {
    const current = snapshot.draft;
    const start = composer?.selectionStart ?? current.length;
    const end = composer?.selectionEnd ?? current.length;
    fluoState.setDraft(`${current.slice(0, start)}${emoji}${current.slice(end)}`);
    emojiOpen = false;
    void tick().then(() => {
      if (!composer) return;
      const caret = start + emoji.length;
      composer.focus({ preventScroll: true });
      composer.setSelectionRange(caret, caret);
    });
  }

  async function publish() {
    await mediaPreparation;
    if (await fluoState.publishPost()) {
      if (composer) composer.style.height = '';
      composerOpen = false;
      emojiOpen = false;
      void tick().then(() => composerTrigger?.focus({ preventScroll: true }));
    }
  }

  async function saveNodeSelection(nodeId: string): Promise<boolean> {
    await fluoState.selectNode(nodeId);
    return true;
  }

  function attachFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (!files.length || !fluoState.addAttachments(files)) return;
    const preparation = Promise.all(files.map(async (file) => {
      const dimensions = await readMediaDimensions(file);
      if (dimensions) fluoState.setDraftAttachmentDimensions(file, dimensions.width, dimensions.height);
    })).then(() => undefined);
    mediaPreparation = Promise.all([mediaPreparation, preparation]).then(() => undefined);
  }

  async function readMediaDimensions(file: File): Promise<{ height: number; width: number } | null> {
    const source = URL.createObjectURL(file);
    try {
      return isVideoFile(file)
        ? await readVideoDimensions(source)
        : await readImageDimensions(source);
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  function readImageDimensions(source: string): Promise<{ height: number; width: number } | null> {
    return new Promise((resolve) => {
      const image = new Image();
      const timeout = window.setTimeout(() => finish(null), 1_600);
      const finish = (dimensions: { height: number; width: number } | null) => {
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        resolve(dimensions);
      };
      image.onload = () => finish(image.naturalWidth && image.naturalHeight
        ? { height: image.naturalHeight, width: image.naturalWidth }
        : null);
      image.onerror = () => finish(null);
      image.src = source;
    });
  }

  function readVideoDimensions(source: string): Promise<{ height: number; width: number } | null> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      const timeout = window.setTimeout(() => finish(null), 1_600);
      const finish = (dimensions: { height: number; width: number } | null) => {
        window.clearTimeout(timeout);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
        resolve(dimensions);
      };
      video.onloadedmetadata = () => finish(video.videoWidth && video.videoHeight
        ? { height: video.videoHeight, width: video.videoWidth }
        : null);
      video.onerror = () => finish(null);
      video.src = source;
    });
  }

  function isVideoFile(file: File): boolean {
    return file.type.toLowerCase().startsWith('video/') ||
      /\.(?:3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(file.name);
  }

  function resizeComposer(event: Event) {
    const textarea = event.currentTarget as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    publish();
  }

  function uploadBytes(value: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let unit = 0;
    while (amount >= 1_024 && unit < units.length - 1) { amount /= 1_024; unit += 1; }
    const precision = unit >= 3 ? 2 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(precision)} ${units[unit]}`;
  }

</script>

<svelte:window onpointerdown={handleWindowPointerdown} />

<main bind:this={shell} class="fluo-shell" aria-labelledby="fluo-title">
  <div class="fluo-layout">
    <section class="feed-column" aria-label="Global Fluo timeline">
      <header class="feed-header">
        <div>
          <span class="section-eyebrow">Public conversation</span>
          <h1 id="fluo-title">Global timeline</h1>
        </div>
        <div class="feed-header-actions">
          <button
            class="feed-refresh-button"
            class:is-refreshing={snapshot.isRefreshing}
            type="button"
            disabled={snapshot.isRefreshing}
            aria-label="Refresh feed"
            aria-busy={snapshot.isRefreshing}
            title="Refresh feed"
            onclick={() => void fluoState.refreshFeed()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 9a6 6 0 0 0-10.6-3.8L4 6.7M4 4v2.7h2.7M4 11a6 6 0 0 0 10.6 3.8l1.4-1.5M16 16v-2.7h-2.7" /></svg>
            <span>Refresh</span>
          </button>
          <span class="node-badge">
            <i aria-hidden="true"></i>
            All available Nodo
          </span>
        </div>
      </header>

      <button
        bind:this={composerTrigger}
        class="sui-btn fluo-create-trigger"
        type="button"
        aria-label="Create a post"
        onclick={openComposer}
      >
        <svg class="fluo-create-trigger__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.75 19.25h4.1L19 9.1a2.12 2.12 0 0 0-3-3L5.85 16.25z" />
          <path d="m14.5 7.5 2 2" />
        </svg>
        <span>New post</span>
      </button>

      {#if snapshot.storageError}
        <p class="storage-error" role="alert">{snapshot.storageError}</p>
      {/if}

      <div class="timeline-divider">
        <span>Latest</span>
        <i></i>
      </div>

      {#if snapshot.posts.length}
        <FluoTimeline
          hasMore={snapshot.hasMore}
          isLoading={snapshot.isLoading}
          isLoadingMore={snapshot.isLoadingMore}
          isRefreshing={snapshot.isRefreshing}
        posts={snapshot.posts}
        scrollElement={shell}
        {active}
        {fluoState}
      />
      {:else}
        <div class="empty-feed">
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 5h12v10H9l-3 3V5Zm4 4h4m-4 3h6" /></svg>
          </span>
          <h2>The global feed is quiet</h2>
          <p>Posts from every available Nodo will appear here in publication order. Choosing a Nodo above only decides where your next post is stored.</p>
          {#if snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION ? publicAvailable : selectedNode}
            <button type="button" onclick={openComposer}>Write a post</button>
          {/if}
        </div>
      {/if}
    </section>

    <aside class="feed-aside" aria-label="About Fluo">
      <section class="aside-card aside-card--intro">
        <span class="aside-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3.5 19 7v5c0 4-2.6 7-7 8.5C7.6 19 5 16 5 12V7l7-3.5Zm-3 8 2 2 4-4" /></svg>
        </span>
        <h2>Node-backed by design</h2>
        <p>Posts and media go directly to Nodo storage. Public Nodo automatically finds shared capacity; Cloudflare only coordinates placement and quota.</p>
      </section>
      <section class="aside-card">
        <span class="aside-label">Storage flow</span>
        <ul>
          <li><i></i><span><strong>Choose</strong><small>Use the public pool or one of your private hosts</small></span></li>
          <li><i></i><span><strong>Transfer</strong><small>Upload directly with resumable tus</small></span></li>
          <li><i></i><span><strong>Own</strong><small>Keep the original bytes on your device</small></span></li>
        </ul>
      </section>
    </aside>
  </div>
</main>

{#if composerOpen}
  <div
    class="sui-modal-backdrop sui-modal-static sui-modal-open"
    role="dialog"
    aria-modal="true"
    aria-labelledby="fluo-compose-title"
    tabindex="-1"
    onkeydown={handleComposerDialogKeydown}
    onclick={handleComposerBackdropClick}
  >
    <section bind:this={composerModal} class="sui-modal sui-modal-lg fluo-compose-modal" tabindex="-1">
      <header class="sui-modal-header">
        <div class="fluo-compose-heading">
          <span class="fluo-compose-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 5h14v10H9l-4 4V5Zm4 5h6m-6 3h4" /></svg>
          </span>
          <div>
            <span class="fluo-compose-eyebrow">FLUO</span>
            <h2 id="fluo-compose-title">Create a post</h2>
          </div>
        </div>
        <button class="sui-modal-close" type="button" aria-label="Close post composer" disabled={snapshot.isPublishing} onclick={closeComposer}></button>
      </header>

      <form class="sui-modal-body fluo-compose-form" novalidate onsubmit={(event) => { event.preventDefault(); void publish(); }}>
        <div class="sui-form-group fluo-compose-node-group">
          <label class="sui-label" for="fluo-node-storage">Store this post on</label>
          <button
            id="fluo-node-storage"
            class="fluo-node-selection"
            type="button"
            aria-label={`Choose storage Nodo, currently ${selectedNodeName}`}
            disabled={snapshot.isPublishing || snapshot.isLoading && !snapshot.publicStorage}
            onclick={() => { nodePickerOpen = true; }}
          >
            <span class="fluo-node-selection__icon" aria-hidden="true">
              <svg viewBox="0 0 28 28"><rect x="4" y="4.5" width="20" height="19" rx="3"/><circle cx="10" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M8 21l2-5h8l2 5M10 12h8"/></svg>
              <i style={`--node-fill:${selectedNodeFill}%`}></i>
            </span>
            <span class="fluo-node-selection__copy">
              <strong>{selectedNodeName}</strong>
              <small>{selectedNodeQuota ? `${uploadBytes(selectedNodeUsed)} of ${uploadBytes(selectedNodeQuota)}` : 'Storage unavailable'}</small>
            </span>
            <svg class="fluo-node-selection__chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
          </button>
          {#if !snapshot.isLoading && snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION && !publicAvailable}
            <span class="sui-form-hint sui-hint-warning">No writable Public Nodo is reachable right now.</span>
          {:else if !snapshot.isLoading && snapshot.selectedNodeId !== PUBLIC_FLUO_DESTINATION && !selectedNode}
            <span class="sui-form-hint sui-hint-warning">Start one of your private Nodo hosts before publishing.</span>
          {/if}
        </div>

        <hr class="sui-divider" />

        <div class="sui-form-group fluo-compose-text-group">
          <label class="sui-label" for="fluo-post-text">Your message</label>
          <textarea
            bind:this={composer}
            id="fluo-post-text"
            class="sui-input sui-textarea"
            aria-label="Post text"
            maxlength={FLUO_MAX_POST_LENGTH}
            placeholder="What is worth sharing?"
            rows="4"
            disabled={snapshot.isPublishing}
            bind:value={() => snapshot.draft, (draft) => fluoState.setDraft(draft)}
            oninput={resizeComposer}
            onkeydown={handleComposerKeydown}
          ></textarea>
          <div class="fluo-compose-meta">
            <span>{mediaCount}/{FLUO_MAX_ATTACHMENTS} media</span>
            <span class:character-count--near={remaining < 80}>{remaining} characters left</span>
          </div>
        </div>

        {#if snapshot.draftAttachments.length}
          <div class="draft-media" aria-label="Attached media">
            {#each snapshot.draftAttachments as attachment (attachment.id)}
              <figure class:media-video={attachment.kind === 'video'}>
                {#if attachment.kind === 'video'}
                  <video src={attachment.url} muted preload="metadata" aria-label={attachment.name}></video>
                {:else}
                  <img src={attachment.url} alt={attachment.name} />
                {/if}
                {#if attachment.kind !== 'image'}<span>{attachment.kind === 'gif' ? 'GIF' : 'VIDEO'}</span>{/if}
                <button
                  type="button"
                  disabled={snapshot.isPublishing}
                  aria-label={`Remove ${attachment.name}`}
                  title="Remove attachment"
                  onclick={() => fluoState.removeAttachment(attachment.id)}
                >×</button>
              </figure>
            {/each}
          </div>
        {/if}
        {#if snapshot.attachmentError}
          <p class="attachment-error" role="alert">{snapshot.attachmentError}</p>
        {/if}
        {#if snapshot.uploadProgress}
          <div
            class="upload-progress"
            role="progressbar"
            aria-label="Media upload progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={uploadPercent}
          >
            <div class="upload-copy">
              <span>Uploading {snapshot.uploadProgress.attachmentName} <small>{snapshot.uploadProgress.attachmentIndex}/{snapshot.uploadProgress.attachmentTotal}</small></span>
              <strong>{uploadPercent}%</strong>
            </div>
            <div class="upload-track"><i style={`width:${uploadPercent}%`}></i></div>
            <p>{uploadBytes(snapshot.uploadProgress.uploadedBytes)} of {uploadBytes(snapshot.uploadProgress.totalBytes)} transferred</p>
          </div>
        {/if}

        <hr class="sui-divider" />

        <input
          bind:this={attachmentInput}
          class="media-input"
          type="file"
          accept="image/*,video/*"
          multiple
          onchange={attachFiles}
        />
        <footer class="sui-modal-footer fluo-compose-footer">
          <div class="fluo-compose-tools">
            <button
              class="sui-btn sui-btn-icon fluo-compose-icon-button"
              type="button"
              disabled={snapshot.isPublishing}
              aria-label="Attach media"
              title="Attach images, GIFs, or videos"
              onclick={() => attachmentInput?.click()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><circle cx="9" cy="9" r="1.5"/><path d="m6 17 4.2-4.2 2.7 2.4 2.1-2.1L18 17" /></svg>
            </button>
            <div bind:this={emojiWrap} class="fluo-emoji-wrap">
              <button
                class="sui-btn sui-btn-icon fluo-compose-icon-button"
                type="button"
                disabled={snapshot.isPublishing}
                aria-label="Add emoji"
                aria-expanded={emojiOpen}
                title="Add emoji"
                onclick={() => { emojiOpen = !emojiOpen; }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r=".8" fill="currentColor" stroke="none"/><path d="M8.5 14c1.8 2.4 5.2 2.4 7 0" /></svg>
              </button>
              {#if emojiOpen}
                <div class="fluo-emoji-popover" role="menu" aria-label="Choose an emoji">
                  {#each EMOJI_OPTIONS as emoji}
                    <button type="button" role="menuitem" aria-label={`Insert ${emoji}`} onclick={() => insertEmoji(emoji)}>{emoji}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <span class="fluo-compose-media-count">{mediaCount}/{FLUO_MAX_ATTACHMENTS} media</span>
          </div>
          <button
            class="sui-btn sui-btn-primary fluo-compose-post-button"
            type="submit"
            disabled={snapshot.isPublishing || !destinationAvailable || (!snapshot.draft.trim() && !snapshot.draftAttachments.length)}
          >{snapshot.uploadProgress ? 'Uploading…' : snapshot.isPublishing ? 'Saving…' : 'Post'}</button>
        </footer>
      </form>
    </section>
  </div>
{/if}

{#if nodePickerOpen}
  <NodoPickerDialog
    description="Choose the Public Nodo pool or one of your private hosts. This only changes where the next post is stored."
    nodes={snapshot.nodes}
    onClose={() => { nodePickerOpen = false; }}
    onSave={saveNodeSelection}
    publicNodeId={PUBLIC_FLUO_DESTINATION}
    publicStorage={snapshot.publicStorage}
    selectedNodeId={snapshot.selectedNodeId ?? PUBLIC_FLUO_DESTINATION}
    title="Post storage"
  />
{/if}

<style>
  .fluo-shell {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overflow-anchor: none;
    overscroll-behavior: contain;
    scroll-behavior: auto;
    scrollbar-gutter: stable;
    touch-action: pan-y;
    will-change: scroll-position;
    color: #2b3530;
    background: #f4f6f2;
    /* Keep fixed controls viewport-anchored; paint containment would make a
       fixed descendant relative to this scrolling surface. */
    contain: style;
    isolation: isolate;
  }

  /* SoftUI's vendored palette is scoped here so its global reset cannot alter
     the rest of Kaordo. */
  .fluo-shell,
  .sui-modal-backdrop {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-shadow-light: #fff;
    --sui-shadow-dark: #b8c0cc;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-radius-sm: 10px;
    --sui-radius: 16px;
    --sui-radius-lg: 24px;
    --sui-shadow-raised: 6px 6px 14px var(--sui-shadow-dark), -6px -6px 14px var(--sui-shadow-light);
    --sui-shadow-raised-sm: 3px 3px 8px var(--sui-shadow-dark), -3px -3px 8px var(--sui-shadow-light);
    --sui-shadow-raised-lg: 10px 10px 20px var(--sui-shadow-dark), -10px -10px 20px var(--sui-shadow-light);
    --sui-shadow-inset: inset 3px 3px 8px var(--sui-shadow-dark), inset -3px -3px 8px var(--sui-shadow-light);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-dark), inset -2px -2px 5px var(--sui-shadow-light);
  }

  :global(html[data-theme='dark']) .fluo-shell,
  :global(html[data-theme='dark']) .sui-modal-backdrop {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-shadow-light: #33363f;
    --sui-shadow-dark: #1e2027;
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-text: #e2e8f0;
    --sui-text-muted: #9ba5b8;
  }

  .fluo-layout {
    display: grid;
    grid-template-columns: minmax(520px, 680px) 264px;
    align-items: start;
    justify-content: center;
    gap: 22px;
    width: min(100%, 1020px);
    min-height: 100%;
    margin: 0 auto;
    padding: 28px 28px 54px;
  }

  .feed-column { min-width: 0; }

  .feed-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 2px 3px 20px;
  }

  .feed-header-actions {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .section-eyebrow,
  .aside-label {
    color: #588577;
    font-size: calc(9px * var(--text-scale));
    font-weight: 730;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  h1 {
    margin-top: 6px;
    color: #223029;
    font-size: calc(25px * var(--text-scale));
    font-weight: 690;
    letter-spacing: -0.035em;
  }

  .node-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 25px;
    padding: 0 9px;
    color: #607068;
    background: rgb(255 255 255 / 65%);
    border: 1px solid #d6ddd8;
    border-radius: 999px;
    font-size: calc(9px * var(--text-scale));
    font-weight: 620;
  }

  .node-badge i {
    width: 6px;
    height: 6px;
    background: #55a087;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgb(85 160 135 / 12%);
  }

  .feed-refresh-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 25px;
    padding: 0 8px;
    color: #4d806f;
    background: rgb(255 255 255 / 62%);
    border: 1px solid #d1ddd6;
    border-radius: 999px;
    font: inherit;
    font-size: calc(9px * var(--text-scale));
    font-weight: 650;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease,
      transform 160ms ease;
  }

  .feed-refresh-button:hover:not(:disabled) {
    color: #2f705d;
    background: #edf6f1;
    border-color: #aac9bb;
    transform: translateY(-1px);
  }

  .feed-refresh-button:disabled { cursor: wait; opacity: .72; }
  .feed-refresh-button svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.55; }
  .feed-refresh-button.is-refreshing svg { animation: feed-refresh-spin .75s linear infinite; }

  @keyframes feed-refresh-spin { to { transform: rotate(360deg); } }

  .fluo-create-trigger {
    position: fixed;
    display: inline-flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    right: max(28px, calc((100% - 1000px) / 2 + 25px));
    left: auto;
    bottom: 46px;
    z-index: 90;
    width: 256px;
    min-width: 254px;
    height: 48px;
    padding: 0 24px;
    color: #2d3748;
    background: #fff;
    border: 1px solid #c8d1de;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    font-size: calc(12px * var(--text-scale));
    font-weight: 700;
    letter-spacing: .01em;
    white-space: nowrap;
    box-shadow: 3px 3px 8px #b8c0cc, -3px -3px 8px #fff;
    transition: background 130ms ease, border-color 130ms ease,
      box-shadow 130ms ease, color 130ms ease, transform 130ms ease;
  }

  .fluo-create-trigger__icon {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .fluo-create-trigger > span {
    display: block;
    flex: 0 0 auto;
    line-height: 1;
  }

  .fluo-create-trigger:hover {
    color: var(--sui-primary);
    background: #fbfcfe;
    border-color: #b8c5d5;
    box-shadow: 4px 4px 10px #b8c0cc, -3px -3px 9px #fff;
    transform: translateY(-1px);
  }

  .fluo-create-trigger:active {
    color: var(--sui-primary);
    background: #f0f3f8;
    border-color: #c8d1de;
    box-shadow: inset 2px 2px 5px #b8c0cc, inset -2px -2px 5px #fff;
    transform: translateY(1px) scale(.985);
  }

  .fluo-create-trigger:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent);
    outline-offset: 3px;
  }

  :global(html[data-theme='dark']) .fluo-create-trigger {
    color: var(--sui-text);
    background: var(--sui-bg);
    border-color: #4b5361;
    box-shadow: 3px 3px 8px #1e2027, -3px -3px 8px #33363f;
  }

  :global(html[data-theme='dark']) .fluo-create-trigger:hover {
    color: var(--sui-primary);
    background: var(--sui-bg-light);
    border-color: #5b6574;
    box-shadow: 4px 4px 10px #1e2027, -3px -3px 9px #33363f;
  }

  :global(html[data-theme='dark']) .fluo-create-trigger:active {
    background: var(--sui-bg-dark);
    box-shadow: inset 2px 2px 5px #1e2027, inset -2px -2px 5px #33363f;
  }


  /* SoftUI large form modal, kept scoped to Fluo so the vendored library's
     global reset never changes the rest of the application. */
  .sui-modal-backdrop {
    position: fixed;
    top: var(--app-header-height, 32px);
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    height: auto;
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, var(--chrome, #1c2825) 34%, transparent);
    animation: fluo-modal-fade 160ms ease-out both;
  }

  .sui-modal {
    width: min(720px, calc(100vw - 34px));
    max-height: min(790px, calc(100vh - 34px));
    overflow: auto;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: var(--sui-radius-lg);
    box-shadow: 0 24px 60px rgb(17 24 39 / 24%);
    outline: none;
    animation: fluo-modal-enter 190ms cubic-bezier(.2,.8,.2,1) both;
  }

  .sui-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 48px;
    padding: 2px 18px;
    background: var(--sui-bg);
    border-bottom: 1px solid color-mix(in srgb, var(--sui-shadow-dark) 22%, transparent);
  }

  .fluo-compose-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .fluo-compose-mark { display: grid; flex: none; width: 42px; height: 42px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 12px; box-shadow: var(--sui-shadow-inset-sm); place-items: center; }
  .fluo-compose-mark svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.55; }
  .fluo-compose-heading > div { min-width: 0; }
  .fluo-compose-eyebrow { display: block; color: var(--sui-primary); font-size: calc(7px * var(--text-scale)); font-weight: 780; letter-spacing: .16em; line-height: 1; }
  .fluo-compose-heading h2 { margin-top: 3px; color: var(--sui-text); font-size: calc(15px * var(--text-scale)); font-weight: 720; letter-spacing: -.03em; }

  .sui-modal-close { position: relative; display: grid; flex: none; width: 32px; height: 32px; padding: 0; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 50%; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; place-items: center; transition: box-shadow 140ms ease, color 140ms ease; }
  .sui-modal-close::before, .sui-modal-close::after { position: absolute; width: 14px; height: 2px; content: ''; background: currentColor; border-radius: 2px; }
  .sui-modal-close::before { transform: rotate(45deg); }
  .sui-modal-close::after { transform: rotate(-45deg); }
  .sui-modal-close:hover:not(:disabled) { color: var(--sui-primary); box-shadow: var(--sui-shadow-inset-sm); }
  .sui-modal-close:disabled { cursor: default; opacity: .45; }

  .sui-modal-body { padding: 18px 20px 0; }
  .fluo-compose-form { display: block; }
  .sui-form-group { margin-bottom: 0; }
  .sui-label { display: block; margin: 0 0 8px; color: var(--sui-text); font-size: calc(10px * var(--text-scale)); font-weight: 720; letter-spacing: .02em; }
  .fluo-node-selection { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 62px; padding: 9px 12px; color: var(--sui-text); text-align: left; background: var(--sui-bg); border: 0; border-radius: var(--sui-radius); box-shadow: var(--sui-shadow-raised); cursor: pointer; transition: box-shadow 140ms ease, transform 140ms ease, color 140ms ease; }
  .fluo-node-selection:hover:not(:disabled) { color: var(--sui-primary); box-shadow: var(--sui-shadow-raised-sm); transform: translateY(-1px); }
  .fluo-node-selection:active:not(:disabled) { color: var(--sui-primary); box-shadow: var(--sui-shadow-inset); transform: translateY(1px) scale(.995); }
  .fluo-node-selection:disabled { cursor: default; opacity: .5; }
  .fluo-node-selection__icon { position: relative; display: grid; flex: none; width: 40px; height: 40px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-shadow-inset-sm); place-items: center; }
  .fluo-node-selection__icon svg { width: 25px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .fluo-node-selection__icon i { position: absolute; right: 3px; bottom: 3px; width: 8px; height: 8px; background: conic-gradient(var(--sui-primary) var(--node-fill), color-mix(in srgb, var(--sui-text-muted) 20%, transparent) 0); border: 1px solid var(--sui-bg); border-radius: 50%; }
  .fluo-node-selection__copy { display: grid; min-width: 0; gap: 3px; }
  .fluo-node-selection__copy strong, .fluo-node-selection__copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fluo-node-selection__copy strong { color: var(--sui-primary); font-size: calc(12px * var(--text-scale)); }
  .fluo-node-selection__copy small { color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); }
  .fluo-node-selection__chevron { width: 18px; height: 18px; margin-left: auto; flex: none; fill: none; stroke: var(--sui-text-muted); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
  .sui-form-hint { display: block; margin-top: 7px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); }
  .sui-hint-warning { color: #f5a623; }
  .sui-divider { height: 0; margin: 19px 0; border: 0; border-top: 1px solid color-mix(in srgb, var(--sui-shadow-dark) 24%, transparent); border-bottom: 1px solid var(--sui-shadow-light); }
  .fluo-compose-text-group .sui-label { margin-bottom: 7px; }
  .sui-input { display: block; width: 100%; padding: 12px 15px; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: var(--sui-radius-sm); box-shadow: var(--sui-shadow-inset); outline: none; font: inherit; transition: box-shadow 140ms ease; }
  .sui-input:focus { box-shadow: var(--sui-shadow-inset), 0 0 0 3px color-mix(in srgb, var(--sui-primary) 20%, transparent); }
  .sui-textarea { min-height: 122px; max-height: 220px; resize: vertical; overflow-x: hidden; overflow-y: auto; line-height: 1.55; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--sui-primary) 52%, transparent) transparent; }
  .sui-input::placeholder { color: var(--sui-text-muted); opacity: .78; }
  .sui-input:disabled { cursor: default; opacity: .6; }
  .fluo-compose-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 7px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); font-variant-numeric: tabular-nums; }
  .fluo-compose-meta .character-count--near { color: color-mix(in srgb, var(--sui-primary) 62%, #b56c54); }

  /* The form already supplies the 20px horizontal inset. Keeping another
     inset here pushed both footer groups toward the center. */
  .fluo-compose-footer { display: grid !important; grid-template-columns: minmax(0, 1fr) auto; align-items: center; width: 100%; gap: 16px; padding: 0 0 18px !important; }
  .fluo-compose-tools { position: relative; display: flex; align-items: center; justify-self: start; gap: 8px; min-width: 0; margin: 0; }
  .fluo-compose-icon-button { display: grid; width: 40px; height: 40px; padding: 0; color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: 50%; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; place-items: center; transition: transform 140ms ease, box-shadow 140ms ease, color 140ms ease; }
  .fluo-compose-icon-button:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); box-shadow: var(--sui-shadow-raised-sm); }
  .fluo-compose-icon-button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset); transform: translateY(1px); }
  .fluo-compose-icon-button:disabled { cursor: default; opacity: .45; }
  .fluo-compose-icon-button svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
  .fluo-compose-media-count { margin-left: 2px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); white-space: nowrap; }
  .fluo-emoji-wrap { position: relative; }
  .fluo-emoji-popover { position: absolute; bottom: calc(100% + 10px); left: 0; z-index: 2; display: grid; grid-template-columns: repeat(4, 34px); gap: 4px; padding: 8px; background: var(--sui-bg); border: 0; border-radius: var(--sui-radius); box-shadow: var(--sui-shadow-raised); animation: fluo-emoji-enter 120ms ease-out both; }
  .fluo-emoji-popover button { display: grid; width: 34px; height: 34px; padding: 0; background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: 18px; place-items: center; }
  .fluo-emoji-popover button:hover { background: var(--sui-bg-light); box-shadow: var(--sui-shadow-inset-sm); }
  .fluo-compose-post-button { flex: 0 0 auto; justify-self: end; min-width: 94px; height: 42px; margin: 0; padding: 0 20px; color: #fff; background: var(--sui-primary); border: 0; border-radius: var(--sui-radius-sm); box-shadow: 4px 4px 12px rgb(48 34 68 / 28%) !important; cursor: pointer; font: inherit; font-size: calc(11px * var(--text-scale)); font-weight: 730; outline: none; -webkit-appearance: none; appearance: none; -webkit-tap-highlight-color: transparent; transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease; }
  .fluo-compose-post-button:hover:not(:disabled) { background: var(--sui-primary-hover); transform: translateY(-1px); box-shadow: 5px 5px 14px rgb(48 34 68 / 32%) !important; }
  .fluo-compose-post-button:active:not(:disabled) { transform: translateY(1px); box-shadow: inset 2px 2px 5px rgb(0 0 0 / 30%) !important; }
  .fluo-compose-post-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 55%, transparent); outline-offset: 3px; box-shadow: 4px 4px 12px rgb(48 34 68 / 28%) !important; }
  .fluo-compose-post-button:focus:not(:focus-visible) { outline: none; }
  .fluo-compose-post-button:disabled { cursor: default; opacity: .43; }

  .media-input { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }

  @keyframes fluo-modal-fade { from { opacity: 0; } }
  @keyframes fluo-modal-enter { from { opacity: 0; transform: translateY(13px) scale(.98); } }
  @keyframes fluo-emoji-enter { from { opacity: 0; transform: translateY(4px) scale(.97); } }

  .draft-media {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 7px;
    padding: 2px 0 11px;
  }

  .draft-media figure {
    position: relative;
    min-width: 0;
    height: 92px;
    margin: 0;
    overflow: hidden;
    background: var(--sui-bg);
    border: 0;
    border-radius: 10px;
    box-shadow: var(--sui-shadow-inset-sm);
  }

  .draft-media :is(img, video) { width: 100%; height: 100%; object-fit: cover; }
  .draft-media figure > span { position: absolute; bottom: 6px; left: 6px; padding: 3px 5px; color: var(--sui-text); background: var(--sui-bg-light); border-radius: 5px; box-shadow: var(--sui-shadow-raised-sm); font-size: calc(7px * var(--text-scale)); font-weight: 750; letter-spacing: .05em; }
  .draft-media button { position: absolute; top: 6px; right: 6px; display: grid; width: 21px; height: 21px; padding: 0; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 50%; box-shadow: 3px 3px 8px rgb(34 44 58 / 30%) !important; cursor: pointer; font-size: calc(15px * var(--text-scale)); line-height: 1; place-items: center; outline: none; -webkit-tap-highlight-color: transparent; transition: transform 120ms ease, box-shadow 120ms ease, color 120ms ease, background 120ms ease; }
  .draft-media button:hover:not(:disabled) { color: #fff; background: #b74a62; transform: translateY(-1px); box-shadow: 4px 4px 9px rgb(34 44 58 / 34%) !important; }
  .draft-media button:active:not(:disabled) { color: #fff; background: #9f3d53; transform: translateY(1px) scale(.93); box-shadow: inset 2px 2px 5px rgb(0 0 0 / 32%) !important; }
  .draft-media button:focus-visible { outline: 2px solid color-mix(in srgb, #b74a62 58%, transparent); outline-offset: 2px; box-shadow: 3px 3px 8px rgb(34 44 58 / 30%) !important; }
  .draft-media button:disabled { opacity: .45; cursor: default; box-shadow: none !important; transform: none; }

  .attachment-error { margin: 0 0 9px; padding: 7px 9px; color: #d03a5c; background: color-mix(in srgb, #d03a5c 10%, var(--sui-bg)); border: 0; border-radius: var(--sui-radius-sm); box-shadow: var(--sui-shadow-inset-sm); font-size: calc(9px * var(--text-scale)); }

  .upload-progress { margin: 1px 0 11px; padding: 10px 11px 9px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: var(--sui-radius-sm); box-shadow: var(--sui-shadow-inset-sm); }
  .upload-copy { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .upload-copy span { min-width: 0; overflow: hidden; color: var(--sui-text); font-size: calc(9px * var(--text-scale)); font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
  .upload-copy small { color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); font-weight: 600; }
  .upload-copy strong { color: var(--sui-primary); font-size: calc(9px * var(--text-scale)); font-variant-numeric: tabular-nums; }
  .upload-track { height: 5px; margin-top: 8px; overflow: hidden; background: var(--sui-bg-dark); border-radius: 99px; box-shadow: var(--sui-shadow-inset-sm); }
  .upload-track i { display: block; min-width: 2px; height: 100%; background: var(--sui-primary); border-radius: inherit; transition: width 140ms linear; }
  .upload-progress p { margin-top: 6px; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); font-variant-numeric: tabular-nums; }

  .storage-error {
    margin-top: 10px;
    padding: 9px 11px;
    color: #98483f;
    background: #faece9;
    border: 1px solid #edcbc5;
    border-radius: 9px;
    font-size: calc(10px * var(--text-scale));
  }

  .timeline-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 22px 3px 10px;
  }

  .timeline-divider span { color: #717d76; font-size: calc(9px * var(--text-scale)); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  .timeline-divider i { flex: 1; height: 1px; background: #dce2dd; }

  .empty-feed {
    display: flex;
    align-items: center;
    flex-direction: column;
    padding: 48px 24px 44px;
    color: #69756e;
    background: rgb(255 255 255 / 50%);
    border: 1px dashed #d2dad5;
    border-radius: 14px;
    text-align: center;
  }

  .empty-feed > span { display: grid; width: 42px; height: 42px; color: #4d8877; background: #e8f1ed; border-radius: 12px; place-items: center; }
  .empty-feed svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .empty-feed h2 { margin-top: 14px; color: #354139; font-size: calc(14px * var(--text-scale)); font-weight: 670; }
  .empty-feed p { max-width: 300px; margin-top: 7px; font-size: calc(10px * var(--text-scale)); line-height: 1.55; }
  .empty-feed button { margin-top: 15px; padding: 0; color: #34725f; background: transparent; border: 0; cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 680; }

  .feed-aside { display: grid; gap: 10px; padding-top: 58px; }
  .aside-card { padding: 16px; background: rgb(255 255 255 / 60%); border: 1px solid #dae1dc; border-radius: 13px; }
  .aside-card--intro { background: linear-gradient(145deg, rgb(233 244 239 / 88%), rgb(255 255 255 / 70%)); border-color: #cbdcd4; }
  .aside-icon { display: grid; width: 31px; height: 31px; color: #387663; background: rgb(255 255 255 / 72%); border: 1px solid #c7dbd2; border-radius: 9px; place-items: center; }
  .aside-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .aside-card h2 { margin-top: 12px; color: #304038; font-size: calc(12px * var(--text-scale)); font-weight: 680; }
  .aside-card p { margin-top: 7px; color: #718078; font-size: calc(9px * var(--text-scale)); line-height: 1.6; }
  .aside-card ul { display: grid; gap: 14px; margin: 14px 0 0; padding: 0; list-style: none; }
  .aside-card li { display: grid; grid-template-columns: 7px minmax(0, 1fr); gap: 9px; align-items: start; }
  .aside-card li > i { width: 6px; height: 6px; margin-top: 4px; background: #8eb5a7; border-radius: 2px; }
  .aside-card li span,
  .aside-card li strong,
  .aside-card li small { display: block; }
  .aside-card li strong { color: #526159; font-size: calc(9px * var(--text-scale)); font-weight: 670; }
  .aside-card li small { margin-top: 2px; color: #8b958f; font-size: calc(8px * var(--text-scale)); line-height: 1.4; }

  @media (max-width: 1120px) {
    .fluo-layout { grid-template-columns: minmax(520px, 700px); }
    .feed-aside { display: none; }
    .fluo-create-trigger {
      right: max(28px, calc((100% - 700px) / 2));
      width: 254px;
      min-width: 254px;
    }
  }

</style>
