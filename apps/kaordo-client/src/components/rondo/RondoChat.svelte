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
  .chat { display: grid; position: relative; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; overflow: hidden; }
  .message-scroll { min-height: 0; padding: 18px 17px 12px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .history-state { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; color: #89948d; font-size: calc(8px * var(--text-scale)); }
  .history-state button { color: #507c6e; background: #edf4f0; border: 1px solid #d2e0d8; border-radius: 8px; cursor: pointer; padding: 6px 10px; font: inherit; font-weight: 680; }
  .history-state i, .composer button i { width: 7px; height: 7px; border: 2px solid #a7c0b6; border-top-color: #3f7966; border-radius: 50%; animation: spin 650ms linear infinite; }
  .first-message { display: flex; align-items: flex-start; flex-direction: column; justify-content: flex-end; min-height: calc(100% - 44px); padding: 22px 10px; }
  .first-message > span { display: grid; width: 48px; height: 48px; color: #4b806f; background: #e5efea; border: 1px solid #cadeD5; border-radius: 15px; font-size: calc(24px * var(--text-scale)); font-weight: 600; place-items: center; }
  .first-message h2 { margin: 14px 0 0; color: #2e3c34; font-size: calc(21px * var(--text-scale)); font-weight: 690; letter-spacing: -.025em; }
  .first-message p { margin: 5px 0 0; color: #879189; font-size: calc(9px * var(--text-scale)); }
  .day-separator { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin: 15px 4px 11px; color: #9aa39d; font-size: calc(7px * var(--text-scale)); font-weight: 690; }
  .day-separator::before, .day-separator::after { height: 1px; background: #e0e5e1; content: ''; }
  .message { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; padding: 7px 8px; border-radius: 9px; transition: background 100ms ease; }
  .message:hover { background: rgb(238 243 239 / 72%); }
  .avatar { display: grid; width: 32px; height: 32px; color: #edf7f2; background: linear-gradient(145deg, #6d9a8b, #3e705f); border-radius: 10px; font-size: calc(9px * var(--text-scale)); font-weight: 760; place-items: center; }
  .message header { display: flex; align-items: baseline; gap: 7px; min-height: 18px; }
  .message strong { color: #34433a; font-size: calc(9px * var(--text-scale)); font-weight: 720; }
  .message time { color: #9da69f; font-size: calc(7px * var(--text-scale)); }
  .message p { margin: 1px 0 0; color: #505d55; font-size: calc(10px * var(--text-scale)); line-height: 1.48; overflow-wrap: anywhere; white-space: pre-wrap; user-select: text; }
  .composer { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: end; gap: 8px; margin: 0 16px 15px; padding: 8px 8px 8px 13px; background: #f1f4f1; border: 1px solid #d5ddd7; border-radius: 13px; box-shadow: 0 5px 15px rgb(40 64 52 / 4%); }
  .composer:focus-within { background: #f7f9f7; border-color: #9ebbac; box-shadow: 0 0 0 3px rgb(76 136 117 / 8%); }
  textarea { width: 100%; height: 38px; max-height: 132px; padding: 9px 0 7px; resize: none; color: #36443b; background: transparent; border: 0; outline: 0; font: inherit; font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  textarea::placeholder { color: #9aa49d; }
  .composer > span { align-self: center; color: #9da59f; font-size: calc(7px * var(--text-scale)); opacity: 0; transition: opacity 120ms; }
  .composer > span.visible { opacity: 1; }
  .composer > button { display: grid; width: 34px; height: 34px; color: white; background: #3f7c68; border: 0; border-radius: 10px; cursor: pointer; place-items: center; }
  .composer > button:disabled { color: #a7b2ab; background: #e2e7e3; cursor: default; }
  .composer svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .return-latest { position: absolute; right: 22px; bottom: 78px; padding: 7px 11px; color: #f7fbf9; background: #447c69; border: 0; border-radius: 9px; box-shadow: 0 7px 18px rgb(38 74 61 / 20%); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 690; }
  .chat-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 16px 8px; padding: 7px 10px; color: #9b5148; background: #faeeec; border: 1px solid #efd0cc; border-radius: 8px; font-size: calc(8px * var(--text-scale)); }
  .chat-error button { color: inherit; background: transparent; border: 0; cursor: pointer; font: inherit; font-weight: 750; }
  .message-menu { position: fixed; z-index: 80; width: 126px; padding: 4px; background: #fff; border: 1px solid #d7ddd9; border-radius: 9px; box-shadow: 0 12px 35px rgb(32 51 42 / 18%); }
  .message-menu button { width: 100%; padding: 8px; color: #a04f45; background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; text-align: left; }
  .message-menu button:hover { background: #f9ecea; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
