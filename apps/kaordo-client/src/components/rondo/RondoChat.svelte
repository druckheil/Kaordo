<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { RondoMessage } from '../../lib/domain/rondo';
  import { shouldUseNativeContextMenu } from '../../lib/ui/contextMenu';

  type Props = {
    atLatest: boolean;
    currentUsername: string;
    error: string | null;
    hasMore: boolean;
    messages: RondoMessage[];
    onDelete: (messageId: string) => Promise<boolean>;
    onLoadOlder: () => Promise<void>;
    onReturnLatest: () => Promise<void>;
    onSend: (body: string) => Promise<boolean>;
    owner: boolean;
    phase: 'idle' | 'loading' | 'ready';
    roomName: string;
    sending: boolean;
  };

  let {
    atLatest, currentUsername, error, hasMore, messages, onDelete, onLoadOlder,
    onReturnLatest, onSend, owner, phase, roomName, sending,
  }: Props = $props();
  let body = $state('');
  let scroller = $state<HTMLElement>();
  let textarea = $state<HTMLTextAreaElement>();
  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  let lastMessageId = $derived(messages.at(-1)?.id ?? '');
  let wasAtLatest = $state(true);
  let scrollFrame = 0;

  onDestroy(() => {
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
  });

  $effect(() => {
    lastMessageId;
    if (!scroller || !atLatest || !wasAtLatest) return;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  function resizeComposer(): void {
    if (!textarea) return;
    textarea.style.height = '0';
    textarea.style.height = `${Math.min(132, Math.max(38, textarea.scrollHeight))}px`;
  }

  async function submit(): Promise<void> {
    const value = body.trim();
    if (!value || sending) return;
    if (await onSend(value)) {
      body = '';
      await tick();
      resizeComposer();
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  }

  async function scroll(): Promise<void> {
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    wasAtLatest = distance < 80;
    if (scroller.scrollTop > 72 || !hasMore || phase === 'loading') return;
    const previousHeight = scroller.scrollHeight;
    await onLoadOlder();
    await tick();
    scroller.scrollTop += scroller.scrollHeight - previousHeight;
  }

  function openMenu(event: MouseEvent, message: RondoMessage): void {
    if (!owner && message.author !== currentUsername) return;
    if (shouldUseNativeContextMenu(event)) return;
    event.preventDefault();
    menu = { id: message.id, x: Math.min(event.clientX, innerWidth - 130), y: Math.min(event.clientY, innerHeight - 56) };
  }

  function time(value: number): string {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value);
  }

  function day(value: number): string {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(value);
  }
</script>

<svelte:window onclick={() => { menu = null; }} />

<section class="chat" aria-label={`#${roomName} messages`}>
  <div class="message-scroll" bind:this={scroller} onscroll={scroll}>
    {#if hasMore || phase === 'loading'}
      <div class="history-state">
        {#if phase === 'loading'}<i></i><span>Loading messages…</span>
        {:else}<button type="button" onclick={onLoadOlder}>Load older messages</button>{/if}
      </div>
    {/if}

    {#if phase === 'ready' && messages.length === 0 && !error}
      <div class="first-message">
        <span>#</span>
        <h2>Start #{roomName}</h2>
        <p>This is the beginning of the room. Messages are stored on its Nodo.</p>
      </div>
    {/if}

    {#each messages as message, index (message.id)}
      {#if index === 0 || day(messages[index - 1]!.createdAt) !== day(message.createdAt)}
        <div class="day-separator"><span>{day(message.createdAt)}</span></div>
      {/if}
      <article class="message" oncontextmenu={(event) => openMenu(event, message)}>
        <span class="avatar">{message.author[0]?.toUpperCase() ?? '?'}</span>
        <div>
          <header><strong>{message.author}</strong><time datetime={new Date(message.createdAt).toISOString()}>{time(message.createdAt)}</time></header>
          <p>{message.body}</p>
        </div>
      </article>
    {/each}
  </div>

  {#if !atLatest}
    <button class="return-latest" type="button" onclick={onReturnLatest}>Return to latest</button>
  {/if}
  {#if error}<div class="chat-error" role="alert"><span>{error}</span><button type="button" onclick={onReturnLatest}>Retry</button></div>{/if}

  <form class="composer" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <textarea
      aria-label={`Message #${roomName}`}
      bind:this={textarea}
      bind:value={body}
      maxlength="4000"
      oninput={resizeComposer}
      onkeydown={keydown}
      placeholder={`Message #${roomName}`}
      rows="1"
    ></textarea>
    <span class:visible={body.length > 3600}>{body.length}/4000</span>
    <button aria-label="Send message" disabled={!body.trim() || sending} type="submit">
      {#if sending}<i></i>{:else}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 4 14 6-14 6 2-6-2-6Zm2 6h8" /></svg>{/if}
    </button>
  </form>

  {#if menu}
    <div class="message-menu" role="menu" style={`left:${menu.x}px;top:${menu.y}px`}>
      <button type="button" role="menuitem" onclick={() => { const id = menu?.id; menu = null; if (id) void onDelete(id); }}>Delete message</button>
    </div>
  {/if}
</section>

<style>
  .chat { display: grid; position: relative; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; overflow: hidden; background: transparent; }
  .message-scroll { min-height: 0; padding: 20px 20px 14px; overflow-y: auto; overscroll-behavior: contain; scrollbar-color: var(--rondo-bg-dark, #d1d9e6) transparent; scrollbar-gutter: stable; }
  .history-state { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); }
  .history-state button { min-height: 29px; padding: 0 11px; color: var(--rondo-primary, #5b54e0); background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 10px; box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); cursor: pointer; font: inherit; font-weight: 710; transition: box-shadow 140ms ease, transform 140ms ease; }
  .history-state button:hover { transform: translateY(-1px); }
  .history-state button:active { box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); transform: none; }
  .history-state i, .composer button i { width: 7px; height: 7px; border: 2px solid color-mix(in srgb, var(--rondo-primary, #5b54e0) 25%, transparent); border-top-color: var(--rondo-primary, #5b54e0); border-radius: 50%; animation: spin 650ms linear infinite; }
  .first-message { display: flex; align-items: flex-start; flex-direction: column; justify-content: flex-end; min-height: calc(100% - 44px); padding: 22px 10px; }
  .first-message > span { display: grid; width: 52px; height: 52px; color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg, #e4e9f0); border-radius: 16px; box-shadow: var(--rondo-shadow-inset), var(--rondo-shadow-raised-sm); font-size: calc(24px * var(--text-scale)); font-weight: 650; place-items: center; }
  .first-message h2 { margin: 14px 0 0; color: var(--rondo-text, #2d3748); font-size: calc(21px * var(--text-scale)); font-weight: 740; letter-spacing: -.025em; }
  .first-message p { margin: 5px 0 0; color: var(--rondo-text-muted, #5c6d84); font-size: calc(9px * var(--text-scale)); }
  .day-separator { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin: 17px 4px 12px; color: var(--rondo-text-light, #7b8ca3); font-size: calc(7px * var(--text-scale)); font-weight: 710; }
  .day-separator::before, .day-separator::after { height: 1px; background: color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 24%, transparent); content: ''; }
  .message { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 11px; padding: 9px 10px; border-radius: 14px; transition: background 140ms ease, transform 140ms ease; }
  .message:hover { background: color-mix(in srgb, var(--rondo-bg-light, #edf1f7) 72%, transparent); transform: translateX(1px); }
  .avatar { display: grid; width: 34px; height: 34px; color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border-radius: 12px; box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); font-size: calc(9px * var(--text-scale)); font-weight: 760; place-items: center; }
  .message header { display: flex; align-items: baseline; gap: 8px; min-height: 19px; }
  .message strong { color: var(--rondo-text, #2d3748); font-size: calc(9px * var(--text-scale)); font-weight: 760; }
  .message time { color: var(--rondo-text-light, #7b8ca3); font-size: calc(7px * var(--text-scale)); }
  .message p { margin: 1px 0 0; color: var(--rondo-text-muted, #5c6d84); font-size: calc(10px * var(--text-scale)); line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; user-select: text; }
  .composer { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: end; gap: 9px; margin: 0 20px 18px; padding: 9px 9px 9px 14px; background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 17px; box-shadow: var(--rondo-shadow-inset); transition: box-shadow 150ms ease, background 150ms ease; }
  .composer:focus-within { background: var(--rondo-surface-strong, #eef2f8); box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); }
  textarea { width: 100%; height: 38px; max-height: 132px; padding: 9px 0 7px; resize: none; color: var(--rondo-text, #2d3748); background: transparent; border: 0; outline: 0; font: inherit; font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  textarea::placeholder { color: var(--rondo-text-light, #7b8ca3); }
  .composer > span { align-self: center; color: var(--rondo-text-light, #7b8ca3); font-size: calc(7px * var(--text-scale)); opacity: 0; transition: opacity 120ms; }
  .composer > span.visible { opacity: 1; }
  .composer > button { display: grid; width: 36px; height: 36px; color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border: 0; border-radius: 12px; box-shadow: 4px 5px 11px rgb(74 68 196 / 24%), -2px -2px 6px rgb(255 255 255 / 40%); cursor: pointer; place-items: center; transition: box-shadow 140ms ease, transform 140ms ease; }
  .composer > button:hover:not(:disabled) { transform: translateY(-1px); }
  .composer > button:active:not(:disabled) { box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); transform: none; }
  .composer > button:disabled { color: var(--rondo-text-light, #7b8ca3); background: var(--rondo-bg-dark, #d1d9e6); box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); cursor: default; }
  .composer svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .return-latest { position: absolute; right: 24px; bottom: 83px; min-height: 31px; padding: 0 12px; color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border: 0; border-radius: 11px; box-shadow: 4px 5px 11px rgb(74 68 196 / 24%); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 710; }
  .chat-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 20px 9px; padding: 9px 12px; color: var(--rondo-danger, #c75b68); background: color-mix(in srgb, var(--rondo-danger, #c75b68) 10%, var(--rondo-surface, #e8edf4)); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); font-size: calc(8px * var(--text-scale)); }
  .chat-error button { color: inherit; background: transparent; border: 0; cursor: pointer; font: inherit; font-weight: 760; }
  .message-menu { position: fixed; z-index: 80; width: 136px; padding: 5px; background: var(--rondo-surface-strong, #eef2f8); border: 0; border-radius: 13px; box-shadow: var(--rondo-shadow-raised); }
  .message-menu button { width: 100%; min-height: 31px; padding: 0 9px; color: var(--rondo-danger, #c75b68); background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 710; text-align: left; }
  .message-menu button:hover { background: color-mix(in srgb, var(--rondo-danger, #c75b68) 10%, transparent); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
