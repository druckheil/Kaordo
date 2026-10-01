<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import type { LigoMessage, LigoReaction } from '@kaordo/contracts';
  import { Button, ChevronLeftIcon, CircleIcon, MessageCircleIcon } from '@kaordo/ui';
  import DraftAttachment from './DraftAttachment.svelte';
  import MessageBubble from './MessageBubble.svelte';
  import { startsSenderRun } from './message-grouping';
  import type { PendingMessage } from './types';

  let {
    conversationId, messages, pending, viewerId, personal, group, hasMore, loadingMore, loadOlder, retry,
    react, edit, remove
  }: {
    conversationId: string;
    messages: LigoMessage[];
    pending: PendingMessage[];
    viewerId: string;
    personal: boolean;
    group: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    loadOlder: () => Promise<void>;
    retry: (item: PendingMessage) => void;
    react: (message: LigoMessage, emoji: LigoReaction['emoji']) => Promise<void>;
    edit: (message: LigoMessage, text: string) => Promise<void>;
    remove: (message: LigoMessage) => Promise<void>;
  } = $props();

  let scroller = $state<HTMLDivElement>();
  let atBottom = $state(true);
  let loadingPrevious = $state(false);
  let observedConversation = '';
  let observedLast = '';
  const items = $derived([
    ...messages.map((message) => ({ kind: 'sent' as const, message, key: message.id })),
    ...pending.map((message) => ({ kind: 'pending' as const, message, key: message.clientId }))
  ]);
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => scroller ?? null,
    estimateSize: (index) => {
      const item = items[index];
      if (!item) return 84;
      const text = item.kind === 'sent' ? item.message.text : item.message.text;
      const media = item.kind === 'sent' ? item.message.media : item.message.files;
      return 80 + Math.ceil(text.length / 48) * 22 + (media.length ? 240 : 0);
    },
    overscan: 5
  });

  $effect(() => {
    const keys = items.map((item) => item.key);
    untrack(() => $virtualizer.setOptions({ count: keys.length, getItemKey: (index) => keys[index] ?? index }));
  });

  $effect(() => {
    const id = conversationId;
    const last = items.at(-1)?.key ?? '';
    if (!last) {
      observedConversation = id;
      observedLast = '';
      return;
    }
    const fresh = observedConversation !== id || !observedLast;
    const next = last !== observedLast;
    observedConversation = id;
    observedLast = last;
    if (fresh || (next && atBottom)) {
      void tick().then(() => requestAnimationFrame(() => {
        if (scroller && conversationId === id) $virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
      }));
    }
  });

  async function more() {
    if (loadingPrevious || loadingMore || !hasMore || !scroller) return;
    loadingPrevious = true;
    const oldHeight = scroller.scrollHeight;
    const oldTop = scroller.scrollTop;
    try {
      await loadOlder();
      await tick();
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = oldTop + scroller.scrollHeight - oldHeight;
        loadingPrevious = false;
      });
    } catch {
      loadingPrevious = false;
    }
  }

  function onScroll() {
    if (!scroller) return;
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    if (scroller.scrollTop < 120 && hasMore) void more();
  }

  function measure(node: HTMLDivElement) {
    $virtualizer.measureElement(node);
  }

</script>

<div bind:this={scroller} onscroll={onScroll} class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--primary)_5%,transparent),transparent_60%)] px-3 py-4 sm:px-7"
  role="log" aria-label="Messages" aria-live="polite">
  {#if hasMore}
    <div class="sticky top-0 z-10 flex justify-center">
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
    <div class="flex min-h-full flex-col justify-end">
    <div class="relative w-full shrink-0" style:height={`${$virtualizer.getTotalSize()}px`}>
      {#each $virtualizer.getVirtualItems() as row (row.key)}
        {@const item = items[row.index]}
        {#if item}
          {@const previous = items[row.index - 1]}
          {@const continuesRun = item.kind === 'sent' && previous?.kind === 'sent' &&
            !startsSenderRun(previous.message, item.message)}
          <div data-index={row.index} use:measure
            class={`absolute left-0 top-0 w-full ${continuesRun ? 'pb-1' : 'pb-2.5'}`}
            style:transform={`translateY(${row.start}px)`}>
            {#if item.kind === 'sent'}
              <MessageBubble message={item.message} {viewerId} {personal}
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
        {/if}
      {/each}
    </div>
    </div>
  {/if}
</div>
