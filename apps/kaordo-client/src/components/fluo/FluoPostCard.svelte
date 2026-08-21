<script lang="ts">
  import type { FluoGState, FluoPost } from '../../lib/states/FluoGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import FluoMedia from './FluoMedia.svelte';
  import FluoMediaCarousel from './FluoMediaCarousel.svelte';

  type Props = {
    fluoState: FluoGState;
    post: FluoPost;
    registerMedia: (load: () => Promise<void>) => () => void;
  };

  let { fluoState, post, registerMedia }: Props = $props();

  function postDate(value: number): string {
    const date = new Date(value);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function menuLabel(): string {
    const body = post.body.trim();
    if (body) return body.length > 34 ? `${body.slice(0, 34)}…` : body;
    return `Post with ${post.attachments.length} media`;
  }
</script>

<article
  class="post-card"
  oncontextmenu={(event) => openContextMenu(event, menuLabel(), [
    {
      action: async () => { await fluoState.deletePost(post.id); },
      confirmation: 'Delete this post?',
      danger: true,
      icon: 'delete',
      id: 'delete-fluo-post',
      label: 'Delete post',
    },
  ])}
>
  <span class="avatar" aria-hidden="true">Y</span>
  <div class="post-content">
    <header>
      <strong>{post.author}</strong>
      <span>@{post.author.toLowerCase()}</span>
      <i aria-hidden="true">·</i>
      <time datetime={new Date(post.createdAt).toISOString()}>{postDate(post.createdAt)}</time>
      <span class="post-node-mark" title={`Stored in ${post.space} space on Nodo ${post.nodeId}`}>
        {post.space === 'public' ? 'Public Nodo' : 'Private Nodo'}
      </span>
    </header>
    {#if post.body}<p>{post.body}</p>{/if}
    {#if post.attachments.length}
      {#if post.attachments.length === 1}
        <div class="post-media post-media--single">
          <FluoMedia
            attachment={post.attachments[0]!}
            {fluoState}
            postId={post.id}
            register={registerMedia}
          />
        </div>
      {:else}
        <FluoMediaCarousel
          attachments={post.attachments}
          {fluoState}
          postId={post.id}
          registerMedia={registerMedia}
        />
      {/if}
    {/if}
    <footer class="post-actions">
      <button type="button" disabled aria-label="Reply, coming later" title="Replies are coming later">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h12v8H9l-3.5 3v-3H4z" /></svg>
      </button>
      <button type="button" disabled aria-label="Reflow, coming later" title="Reflow is coming later">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 5-2 2 2 2M4 7h9a3 3 0 0 1 3 3m-2 5 2-2-2-2m2 2H7a3 3 0 0 1-3-3" /></svg>
      </button>
      <button
        class:post-action--active={post.liked}
        type="button"
        aria-label={post.liked ? 'Unlike post' : 'Like post'}
        aria-pressed={post.liked}
        onclick={() => fluoState.toggleLike(post.id)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16S4 12.6 4 8.2C4 5 8 4 10 6.7 12 4 16 5 16 8.2 16 12.6 10 16 10 16Z" /></svg>
      </button>
      <button type="button" disabled aria-label="Share, coming later" title="Sharing is coming later">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 10.5 13 5m0 0H9.5M13 5v3.5M12 9h3v7H5V6h4" /></svg>
      </button>
    </footer>
  </div>
</article>

<style>
  .post-card {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
    width: 100%;
    padding: 15px 17px 10px;
    background: #fff;
    border: 1px solid #d9e0db;
    border-radius: 12px;
    contain: layout paint style;
    transition: border-color 150ms ease;
  }

  .post-card:hover { border-color: #c6d5cd; }

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

  .post-content { min-width: 0; }
  .post-content > header { display: flex; align-items: center; gap: 5px; min-height: 18px; }
  .post-content > header strong { color: #2b3731; font-size: calc(11px * var(--text-scale)); font-weight: 690; }
  .post-content > header span,
  .post-content > header time,
  .post-content > header i { color: #8a948e; font-size: calc(9px * var(--text-scale)); font-style: normal; }

  .post-content > header .post-node-mark {
    margin-left: auto;
    padding: 3px 6px;
    color: #648276;
    background: #edf4f0;
    border-radius: 999px;
    font-size: calc(8px * var(--text-scale));
    font-weight: 650;
  }

  .post-content > p {
    margin-top: 7px;
    color: #35413b;
    font-size: calc(12px * var(--text-scale));
    line-height: 1.62;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .post-media {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
    width: 100%;
    margin-top: 11px;
    align-items: start;
    justify-items: start;
  }

  .post-media--single {
    display: flex;
    width: fit-content;
    max-width: 100%;
    align-items: flex-start;
  }

  .post-actions {
    display: grid;
    grid-template-columns: repeat(4, 32px);
    gap: 15px;
    margin-top: 10px;
  }

  .post-actions button {
    display: grid;
    width: 29px;
    height: 27px;
    padding: 0;
    color: #8b9891;
    background: transparent;
    border: 0;
    border-radius: 7px;
    cursor: pointer;
    place-items: center;
  }

  .post-actions button:hover:not(:disabled) { color: #377765; background: #ebf3ef; }
  .post-actions button:disabled { opacity: 0.42; cursor: default; }
  .post-actions .post-action--active { color: #b45461; background: #faedf0; }
  .post-actions svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .post-actions .post-action--active svg { fill: currentColor; }

  @media (prefers-reduced-motion: reduce) {
    .post-card { transition: none; }
  }
</style>
