<script lang="ts">
	// Shows a compact, linked preview of a quoted or parent post

  import type { FluoPost, FluoQuote } from '@kaordo/contracts';
  import { PlayIcon } from '@kaordo/ui';

  let { quote, onOpen, context = 'quote' }: {
    quote: FluoQuote | Pick<FluoPost, 'id' | 'author' | 'text' | 'media'>;
    onOpen?: (id: string) => void;
    context?: 'quote' | 'reply';
  } = $props();
</script>

{#snippet preview()}
  <span class="block min-w-0 px-4 py-2.5 text-left">
    <span class="block truncate text-sm font-semibold text-foreground">
      {quote.author.displayName}
      <span class="font-normal text-muted-foreground">@{quote.author.username}</span>
    </span>
    {#if quote.text.trim()}
      <span class="mt-1 block line-clamp-3 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/85">{quote.text}</span>
    {/if}
  </span>
  {#if quote.media.length}
    <span
      class={`grid gap-1 overflow-hidden border-t border-border/70 ${quote.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
    >
      {#each quote.media as item, index (item.id)}
        <span class={`relative block overflow-hidden bg-muted ${quote.media.length === 1 ? 'h-44 sm:h-48' : 'h-28 sm:h-36'}`}>
          {#if item.kind === 'image'}
            <img
              src={item.url}
              width={item.width}
              height={item.height}
              loading="lazy"
              decoding="async"
              alt={item.altText || (context === 'reply' ? 'Original post image ' : 'Quoted image ') + (index + 1)}
              class="h-full w-full object-cover"
            />
          {:else}
            <video
              src={item.url}
              muted
              playsinline
              preload="metadata"
              aria-hidden="true"
              class="h-full w-full object-cover"
            ></video>
            <span class="absolute inset-0 grid place-items-center bg-black/30 text-white" aria-hidden="true">
              <PlayIcon class="size-7 fill-current" />
            </span>
            <span class="sr-only">{context === 'reply' ? 'Original post video' : 'Quoted video'} {index + 1}</span>
          {/if}
        </span>
      {/each}
    </span>
  {/if}
{/snippet}

{#if onOpen}
  <button
    type="button"
    class="mt-4 block w-full overflow-hidden rounded-2xl border border-border bg-muted/30 text-left transition-colors hover:border-primary/45 hover:bg-muted/50 focus-visible:outline-3 focus-visible:outline-ring"
    aria-label={'Open quoted post by ' + quote.author.username}
    onclick={() => onOpen?.(quote.id)}
  >
    {@render preview()}
  </button>
{:else}
  <div class="mt-4 overflow-hidden rounded-2xl border border-border bg-muted/30">
    {@render preview()}
  </div>
{/if}
