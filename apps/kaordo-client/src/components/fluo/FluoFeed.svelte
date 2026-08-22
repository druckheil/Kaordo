<script lang="ts">
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
  let shell = $state<HTMLElement>();
  let nodePickerOpen = $state(false);
  let mediaPreparation = Promise.resolve();
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

  async function publish() {
    await mediaPreparation;
    if (await fluoState.publishPost()) {
      if (composer) composer.style.height = '';
      composer?.focus({ preventScroll: true });
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

      <article class="composer-card" aria-label="Create a post">
        <span class="avatar avatar--composer" aria-hidden="true">Y</span>
        <div class="composer-body">
          <div class="node-picker">
            <span class="node-picker-caption">Store this post on</span>
            <div class="node-picker-selection">
              <button
                class="node-storage-button"
                type="button"
                aria-label={`Choose storage Nodo, currently ${selectedNodeName}`}
                title="Choose storage Nodo"
                disabled={snapshot.isPublishing || snapshot.isLoading && !snapshot.publicStorage}
                onclick={() => { nodePickerOpen = true; }}
              >
                <svg viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="4.5" width="20" height="19" rx="3"/><circle cx="10" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M8 21l2-5h8l2 5M10 12h8"/></svg>
                <i style={`--node-fill:${selectedNodeFill}%`}></i>
              </button>
              <span class="node-selection-copy">
                <strong>{selectedNodeName}</strong>
                <small>{selectedNodeQuota ? `${uploadBytes(selectedNodeUsed)} of ${uploadBytes(selectedNodeQuota)}` : 'Storage unavailable'}</small>
              </span>
            </div>
          </div>
          {#if !snapshot.isLoading && snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION && !publicAvailable}
            <p class="node-hint">No writable Public Nodo is reachable right now.</p>
          {:else if !snapshot.isLoading && snapshot.selectedNodeId !== PUBLIC_FLUO_DESTINATION && !selectedNode}
            <p class="node-hint">Start one of your private Nodo hosts before publishing.</p>
          {/if}
          <textarea
            bind:this={composer}
            aria-label="Post text"
            maxlength={FLUO_MAX_POST_LENGTH}
            placeholder="What is worth sharing?"
            rows="3"
            disabled={snapshot.isPublishing}
            bind:value={() => snapshot.draft, (draft) => fluoState.setDraft(draft)}
            oninput={resizeComposer}
            onkeydown={handleComposerKeydown}
          ></textarea>
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
          <footer class="composer-footer">
            <div class="composer-tools">
              <input
                bind:this={attachmentInput}
                class="media-input"
                type="file"
                accept="image/*,video/*"
                multiple
                onchange={attachFiles}
              />
              <button
                class="attach-button"
                type="button"
                disabled={snapshot.isPublishing}
                aria-label="Attach images, GIFs, or videos"
                title="Up to 4 images, GIFs, or videos"
                onclick={() => attachmentInput?.click()}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 4Z"/><circle cx="7" cy="7.5" r="1"/><path d="m4 14 3.8-3.8 2.5 2.3 1.8-1.7L16 14.3"/></svg>
                Media
              </button>
              <span class="media-limits">{mediaCount}/{FLUO_MAX_ATTACHMENTS} media</span>
            </div>
            <div class="composer-actions">
              <span class:character-count--near={remaining < 80}>{remaining}</span>
              <button
                class="post-button"
                type="button"
                disabled={snapshot.isPublishing || !destinationAvailable || (!snapshot.draft.trim() && !snapshot.draftAttachments.length)}
                onclick={publish}
              >{snapshot.uploadProgress ? 'Uploading…' : snapshot.isPublishing ? 'Saving…' : 'Post'}</button>
            </div>
          </footer>
        </div>
      </article>

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
            <button type="button" onclick={() => composer?.focus({ preventScroll: true })}>Write a post</button>
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
    contain: layout paint style;
    isolation: isolate;
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


  .composer-card {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
    background: #fff;
    border: 1px solid #d9e0db;
  }

  .composer-card {
    padding: 16px 17px 13px;
    border-radius: 14px;
    box-shadow:
      0 12px 30px rgb(35 64 52 / 7%),
      inset 0 1px rgb(255 255 255 / 90%);
  }

  .avatar {
    display: grid;
    width: 38px;
    height: 38px;
    color: #f5fbf8;
    background: linear-gradient(145deg, #4d8d79, #2c6555);
    border: 1px solid rgb(36 89 72 / 46%);
    border-radius: 12px;
    box-shadow: inset 0 1px rgb(255 255 255 / 18%);
    font-size: calc(12px * var(--text-scale));
    font-weight: 720;
    place-items: center;
  }

  .avatar--composer { margin-top: 1px; }
  .composer-body { min-width: 0; }

  .node-picker {
    display: grid;
    gap: 6px;
    margin: 0 0 10px;
    padding: 0 2px 10px;
    color: #748078;
    border-bottom: 1px solid #e7ebe8;
    font-size: calc(9px * var(--text-scale));
    font-weight: 650;
  }

  .node-picker-caption { font-weight: 650; }

  .node-picker-selection { display: flex; align-items: center; gap: 9px; min-width: 0; }

  .node-storage-button {
    position: relative;
    display: grid;
    flex: none;
    width: 42px;
    height: 42px;
    padding: 0;
    color: #4d806f;
    background: rgb(255 255 255 / 72%);
    border: 1px solid #c5d9cf;
    border-radius: 12px;
    cursor: pointer;
    place-items: center;
    box-shadow: 0 4px 12px rgb(20 48 39 / 6%);
    transition: transform 120ms ease, background 120ms ease;
  }

  .node-storage-button:hover:not(:disabled) { transform: translateY(-1px); background: #edf6f1; }
  .node-storage-button:disabled { cursor: default; opacity: .5; }
  .node-storage-button svg { width: 25px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .node-storage-button i { position: absolute; right: 4px; bottom: 4px; width: 8px; height: 8px; background: conic-gradient(#4cab7d var(--node-fill), rgb(91 113 103 / 20%) 0); border: 1px solid white; border-radius: 50%; }

  .node-selection-copy { display: grid; min-width: 0; gap: 2px; }
  .node-selection-copy strong { overflow: hidden; color: #3f6f61; font-size: calc(11px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .node-selection-copy small { color: #7b8d84; font-size: calc(9px * var(--text-scale)); }

  .node-hint { margin: -2px 2px 9px; color: #9a6b48; font-size: calc(8px * var(--text-scale)); }

  textarea {
    display: block;
    width: 100%;
    height: auto;
    min-height: 68px;
    padding: 3px 2px 10px;
    resize: none;
    overflow: hidden;
    color: #2c3731;
    background: transparent;
    border: 0;
    outline: none;
    font-size: calc(14px * var(--text-scale));
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  textarea::placeholder { color: #9aa49e; }
  textarea:disabled { opacity: .64; }

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
    background: #e9eeea;
    border: 1px solid #d5ddd8;
    border-radius: 10px;
  }

  .draft-media :is(img, video) { width: 100%; height: 100%; object-fit: cover; }
  .draft-media figure > span { position: absolute; bottom: 6px; left: 6px; padding: 3px 5px; color: #fff; background: rgb(17 29 24 / 76%); border-radius: 5px; font-size: calc(7px * var(--text-scale)); font-weight: 750; letter-spacing: .05em; }
  .draft-media button { position: absolute; top: 6px; right: 6px; display: grid; width: 21px; height: 21px; padding: 0; color: #fff; background: rgb(17 28 23 / 80%); border: 1px solid rgb(255 255 255 / 28%); border-radius: 50%; cursor: pointer; font-size: calc(15px * var(--text-scale)); line-height: 1; place-items: center; }
  .draft-media button:hover { background: #9a4f4b; }
  .draft-media button:disabled { opacity: .45; cursor: default; }

  .attachment-error { margin: 0 0 9px; padding: 7px 9px; color: #8f5144; background: #faefeb; border: 1px solid #ecd3cc; border-radius: 7px; font-size: calc(9px * var(--text-scale)); }

  .upload-progress { margin: 1px 0 11px; padding: 10px 11px 9px; color: #49665a; background: linear-gradient(135deg, #edf6f1, #f7faf8); border: 1px solid #cfe2d9; border-radius: 9px; }
  .upload-copy { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .upload-copy span { min-width: 0; overflow: hidden; font-size: calc(9px * var(--text-scale)); font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
  .upload-copy small { color: #82948b; font-size: calc(7px * var(--text-scale)); font-weight: 600; }
  .upload-copy strong { color: #34735f; font-size: calc(9px * var(--text-scale)); font-variant-numeric: tabular-nums; }
  .upload-track { height: 5px; margin-top: 8px; overflow: hidden; background: #dbe8e1; border-radius: 99px; }
  .upload-track i { display: block; min-width: 2px; height: 100%; background: linear-gradient(90deg, #65ae92, #3d846d); border-radius: inherit; box-shadow: 0 0 9px rgb(61 132 109 / 22%); transition: width 140ms linear; }
  .upload-progress p { margin-top: 6px; color: #829088; font-size: calc(7px * var(--text-scale)); font-variant-numeric: tabular-nums; }

  .composer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-top: 10px;
    border-top: 1px solid #e7ebe8;
  }

  .composer-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .media-input { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
  .attach-button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px; color: #3c7866; background: #edf5f1; border: 1px solid #d2e3dc; border-radius: 7px; cursor: pointer; font: inherit; font-size: calc(9px * var(--text-scale)); font-weight: 670; }
  .attach-button:hover:not(:disabled) { color: #2d6958; background: #e4f0eb; border-color: #bcd5ca; }
  .attach-button:disabled { opacity: .48; cursor: default; }
  .attach-button svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  .media-limits { overflow: hidden; color: #919c95; font-size: calc(8px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }

  .composer-actions { display: flex; align-items: center; gap: 11px; }
  .composer-actions > span { color: #9aa39d; font-size: calc(9px * var(--text-scale)); font-variant-numeric: tabular-nums; }
  .composer-actions .character-count--near { color: #a36d42; }

  .post-button {
    height: 30px;
    padding: 0 15px;
    color: #fff;
    background: #367765;
    border: 1px solid #2d6959;
    border-radius: 8px;
    box-shadow: 0 4px 10px rgb(45 105 89 / 18%);
    cursor: pointer;
    font-size: calc(10px * var(--text-scale));
    font-weight: 690;
  }

  .post-button:hover:not(:disabled) { background: #2d6959; }
  .post-button:disabled { opacity: 0.42; cursor: default; box-shadow: none; }
  .post-button:focus-visible { outline: 2px solid rgb(62 128 109 / 36%); outline-offset: 2px; }

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
  }

  @media (max-width: 720px) {
    .media-limits { display: none; }
  }

</style>
