<script lang="ts">
  // Renders conversation history and preserves the reader's position while it changes

  import { onMount, tick } from 'svelte';
  import type { LigoMessage, LigoReaction } from '@kaordo/contracts';
  import { Button, ChevronLeftIcon, MessageCircleIcon, ShieldCheckIcon } from '@kaordo/ui';
  import MessageBubble from './MessageBubble.svelte';
  import PendingMessageBubble from './PendingMessageBubble.svelte';
  import { startsSenderRun } from './message-grouping';
  import type { PendingMessage } from './types';

  type ScrollSize = { viewport: number; content: number };

  let {
    messages, pending, viewerId, personal, group, hasMore, loadingMore, loadOlder, retry,
    react, edit, remove, showReceipt = true
  }: {
    messages: LigoMessage[];
    pending: PendingMessage[];
    viewerId: string;
    personal: boolean;
    group: boolean;
    showReceipt?: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    loadOlder: () => Promise<void>;
    retry: (item: PendingMessage) => void;
    react: (message: LigoMessage, emoji: LigoReaction['emoji']) => Promise<void>;
    edit: (message: LigoMessage, text: string) => Promise<void>;
    remove: (message: LigoMessage) => Promise<void>;
  } = $props();

  let scroller = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let ready = $state(false);
  let loadingPrevious = $state(false);
  let atBottom = true;
  let observedSize = { viewport: 0, content: 0 };
  const items = $derived([
    ...messages.map((message) => ({ kind: 'sent' as const, message, key: message.id })),
    ...pending.map((message) => ({ kind: 'pending' as const, message, key: message.clientId }))
  ]);

  function scrollToBottom() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function measureScroller(): ScrollSize {
    return {
      viewport: scroller?.clientHeight ?? 0,
      content: scroller?.scrollHeight ?? 0
    };
  }

  function observeResize() {
    if (!scroller) return;

    const size = measureScroller();
    const changed = size.viewport !== observedSize.viewport || size.content !== observedSize.content;
    if (ready && atBottom && changed) scrollToBottom();
    observedSize = size;
  }

  function updateBottomPin(distanceFromEnd: number, size: ScrollSize) {
    if (distanceFromEnd <= 2) atBottom = true;
    else if (size.viewport === observedSize.viewport && size.content === observedSize.content) atBottom = false;
  }

  onMount(() => {
    let disposed = false;
    observedSize = measureScroller();
    const observer = new ResizeObserver(observeResize);
    if (scroller) observer.observe(scroller);
    if (content) observer.observe(content);
    void tick().then(() => {
      if (disposed) return;
      scrollToBottom();
      observedSize = measureScroller();
      ready = true;
    });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  });

  async function more() {
    if (loadingPrevious || loadingMore || !hasMore || !scroller) return;
    loadingPrevious = true;
    // Keep the first loaded message in place as older messages are inserted above it.
    const anchor = scroller.querySelector<HTMLElement>('[data-index]');
    const anchorTop = anchor?.getBoundingClientRect().top;
    try {
      await loadOlder();
      await tick();
      if (anchor?.isConnected && anchorTop !== undefined && scroller) {
        scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
      }
    } catch {
      // The parent query displays its load error and keeps the existing messages.
    } finally {
      loadingPrevious = false;
    }
  }

  function onScroll() {
    if (!ready || !scroller || scroller.scrollTop < 0) return;
    const size = measureScroller();
    const distanceFromEnd = size.content - size.viewport - scroller.scrollTop;
    // A resize can emit scroll before ResizeObserver runs; keep the previous pin in that case.
    updateBottomPin(distanceFromEnd, size);
    if (scroller.scrollTop < 96 && distanceFromEnd > 96 && hasMore) void more();
  }
</script>

<div bind:this={scroller} onscroll={onScroll} class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--primary)_5%,transparent),transparent_60%)] px-3 sm:px-7"
  style:visibility={ready ? 'visible' : 'hidden'}
  role="log" aria-label="Messages" aria-live="polite">
  <div bind:this={content} class="flex min-h-full flex-col justify-end py-4">
    {#if hasMore}
      <div class="sticky top-0 z-10 flex justify-center pb-3" style:overflow-anchor="none">
        <Button variant="secondary" size="xs" disabled={loadingMore || loadingPrevious} onclick={() => void more()}
          aria-label="Load older messages"><ChevronLeftIcon class="size-3.5 rotate-90" />
          {loadingMore || loadingPrevious ? 'Loading…' : 'Earlier messages'}</Button>
      </div>
    {/if}
    {#if items.length === 0}
      <div class="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground" role="status">
        <div class="grid size-14 place-items-center rounded-2xl bg-accent"><MessageCircleIcon class="size-7 text-accent-foreground" /></div>
        <p class="font-semibold text-foreground">No messages yet</p>
        <p class="text-sm">{personal ? 'Save a note or file here for later.' : 'Say hello to start the conversation.'}</p>
      </div>
    {:else}
      {#each items as item, index (item.key)}
        {@const previous = items[index - 1]}
        {@const previousMessage = previous?.kind === 'sent' ? previous.message : null}
        {@const isSentMessage = item.kind === 'sent'}
        {@const continuesRun = isSentMessage && previousMessage !== null && !startsSenderRun(previousMessage, item.message)}
        {@const incomingGroupMessage = isSentMessage && group && item.message.sender.id !== viewerId}
        {@const showSender = incomingGroupMessage && startsSenderRun(previousMessage, item.message)}
        <div data-index={index} class={`w-full ${continuesRun ? 'pb-1' : 'pb-2.5'}`}>
          {#if item.kind === 'sent' && item.message.systemNotice}
            <p class="mx-auto max-w-xl rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center text-sm leading-6 text-foreground" role="status">
              <ShieldCheckIcon class="mr-1 inline size-4 align-[-2px] text-link" />{item.message.text}
            </p>
          {:else if item.kind === 'sent'}
            <MessageBubble message={item.message} {viewerId} {personal} {showReceipt}
              {showSender}
              showAvatarSlot={group && item.message.sender.id !== viewerId}
              {react} {edit} {remove} />
          {:else}
            <PendingMessageBubble message={item.message} {retry} />
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
