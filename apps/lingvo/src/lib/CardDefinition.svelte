<script lang="ts">
  // Renders German grammar, translation and context consistently across learning views
  import type { LingvoCardContent } from '@kaordo/contracts';
  let { card, compact = false, showTerm = true, showTranslation = true, nativeLanguage }:
    { card: LingvoCardContent; compact?: boolean; showTerm?: boolean; showTranslation?: boolean; nativeLanguage?: string } = $props();
</script>

<div class={compact ? 'space-y-2 text-sm' : 'space-y-5'}>
  {#if showTerm}
    <p lang="de" class={compact ? 'text-base font-semibold' : 'text-3xl font-bold tracking-tight sm:text-4xl'}>
      {#if card.article}<span class="german-article mr-1.5" data-article={card.article}>{card.article}</span>{/if}{card.term}
    </p>
  {/if}
  {#if showTranslation}<p lang={nativeLanguage} class={compact ? 'text-muted-foreground' : 'text-xl text-muted-foreground'}>{card.translation}</p>{/if}
  {#if card.plural || card.grammar}
    <div class="flex flex-wrap justify-[inherit] gap-2 text-sm text-muted-foreground">
      {#if card.plural}<span class="rounded-lg bg-muted px-3 py-1.5" lang="de"><span class="mr-1 text-xs">Plural</span> {card.plural}</span>{/if}
      {#if card.grammar}<span class="rounded-lg bg-muted px-3 py-1.5 whitespace-pre-wrap">{card.grammar}</span>{/if}
    </div>
  {/if}
  {#if card.example}
    <blockquote class="border-l-2 border-primary/35 pl-3 text-left">
      <p lang="de" class="leading-6">{card.example}</p>
      {#if card.exampleTranslation}<p lang={nativeLanguage} class="mt-1 text-sm leading-6 text-muted-foreground">{card.exampleTranslation}</p>{/if}
    </blockquote>
  {/if}
  {#if card.notes}<p class="text-sm leading-6 whitespace-pre-wrap text-muted-foreground">{card.notes}</p>{/if}
</div>
