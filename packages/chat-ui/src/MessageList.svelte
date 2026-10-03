<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { LigoMessage, LigoReaction } from '@kaordo/contracts';
  import { Button, ChevronLeftIcon, CircleIcon, MessageCircleIcon, ShieldCheckIcon } from '@kaordo/ui';
  import DraftAttachment from './DraftAttachment.svelte';
  import MessageBubble from './MessageBubble.svelte';
  import { startsSenderRun } from './message-grouping';
  import type { PendingMessage } from './types';

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
  let viewportHeight = 0;
  let contentHeight = 0;
  const items = $derived([
    ...messages.map((message) => ({ kind: 'sent' as const, message, key: message.id })),
    ...pending.map((message) => ({ kind: 'pending' as const, message, key: message.clientId }))
  ]);

  function scrollToBottom() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  onMount(() => {
    let disposed = false;
    viewportHeight = scroller?.clientHeight ?? 0;
    contentHeight = scroller?.scrollHeight ?? 0;
    const observer = new ResizeObserver(() => {
      if (!scroller) return;
      const height = scroller.clientHeight;
      const scrollHeight = scroller.scrollHeight;
      if (ready && atBottom && (height !== viewportHeight || scrollHeight !== contentHeight)) {
        scrollToBottom();
      }
      viewportHeight = height;
      contentHeight = scroller.scrollHeight;
    });
    if (scroller) observer.observe(scroller);
    if (content) observer.observe(content);
    void tick().then(() => {
      if (disposed) return;
      scrollToBottom();
      contentHeight = scroller?.scrollHeight ?? 0;
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
    const distanceFromEnd = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    // A resize can emit scroll before ResizeObserver runs; keep the previous pin in that case.
    if (distanceFromEnd <= 2) atBottom = true;
    else if (scroller.clientHeight === viewportHeight && scroller.scrollHeight === contentHeight) atBottom = false;
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
        <div class="grid size-14 place-items-center rounded-2xl bg-accent"><MessageCircleIcon class="size-7 text-primary" /></div>
        <p class="font-semibold text-foreground">No messages yet</p>
        <p class="text-sm">{personal ? 'Save a note or file here for later.' : 'Say hello to start the conversation.'}</p>
      </div>
    {:else}
      {#each items as item, index (item.key)}
        {@const previous = items[index - 1]}
        {@const continuesRun = item.kind === 'sent' && previous?.kind === 'sent' &&
          !startsSenderRun(previous.message, item.message)}
        <div data-index={index} class={`w-full ${continuesRun ? 'pb-1' : 'pb-2.5'}`}>
          {#if item.kind === 'sent' && item.message.systemNotice}
            <p class="mx-auto max-w-xl rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center text-sm leading-6 text-foreground" role="status">
              <ShieldCheckIcon class="mr-1 inline size-4 align-[-2px] text-primary" />{item.message.text}
            </p>
          {:else if item.kind === 'sent'}
            <MessageBubble message={item.message} {viewerId} {personal} {showReceipt}
              showSender={group && item.message.sender.id !== viewerId &&
                startsSenderRun(previous?.kind === 'sent' ? previous.message : null, item.message)}
              showAvatarSlot={group && item.message.sender.id !== viewerId}
              {react} {edit} {remove} />
          {:else}
            <div class="flex justify-end">
              <article class="min-w-0 max-w-[min(86%,38rem)] rounded-[14px] border border-primary/20 bg-primary/8 p-[2px] shadow-xs sm:max-w-[76%]"
                aria-label="Pending message">
                {#if item.message.files.length}
                  <div class="grid gap-0.5 sm:grid-cols-2">
                    {#each item.message.files as file (file)}
                      <DraftAttachment {file} status={item.message.status} progress={item.message.progress} />
                    {/each}
                  </div>
                {/if}
                {#if item.message.text}<p class={`whitespace-pre-wrap break-words px-2.5 text-sm leading-5 ${item.message.files.length ? 'pt-1' : 'pt-1.5'}`}>{item.message.text}</p>{/if}
                <p class="flex items-center justify-end gap-1 px-2 pb-1.5 pt-0.5 text-[11px] text-muted-foreground" role="status">
                  {#if item.message.status !== 'failed'}<CircleIcon class="size-3 stroke-[1.4] text-muted-foreground/55" aria-label="Sending" />{/if}
                  {item.message.status === 'uploading' ? `Uploading ${item.message.progress}%` :
                    item.message.status === 'sending' ? 'Sending…' : 'Could not send'}
                </p>
                {#if item.message.status === 'failed'}
                  <p class="px-2 pb-1 text-xs text-destructive">{item.message.error}</p>
                  <Button variant="outline" size="xs" class="mx-2 mb-2" onclick={() => retry(item.message)}>Retry</Button>
                {/if}
              </article>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
