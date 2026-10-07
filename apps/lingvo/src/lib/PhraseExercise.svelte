<script lang="ts">
  // Practices German word order and written recall with stable word tiles and explicit hints
  import { flip } from 'svelte/animate';
  import { onMount } from 'svelte';
  import type { LingvoCard } from '@kaordo/contracts';
  import { normalizeAnswer, phraseTokens } from '@kaordo/lingvo-client';
  import { Button, CheckIcon, LightbulbIcon, Textarea, ToggleGroup } from '@kaordo/ui';

  let { card, onReveal }: { card: LingvoCard; onReveal(correct: boolean, hinted: boolean): void } = $props();
  let mode = $state('arrange');
  let chosen = $state<number[]>([]);
  let written = $state('');
  let hinted = $state(false);
  let reducedMotion = $state(true);
  const tiles = $derived(phraseTokens(card.term, card.id + ':' + card.revision));
  const remaining = $derived(tiles.filter(tile => !chosen.includes(tile.id)));
  const answer = $derived(mode === 'arrange' ? chosen.map(id => tiles.find(tile => tile.id === id)?.text).join(' ') : written);
  onMount(() => { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; });

  function hint(): void {
    hinted = true;
    if (mode === 'type') written = card.term.split(/\s+/)[0] + ' ';
    else {
      if (chosen.some((id, index) => id !== index)) chosen = [];
      const next = tiles.find(tile => tile.id === chosen.length);
      if (next) chosen = [...chosen, next.id];
    }
  }

  function check(event: SubmitEvent): void {
    event.preventDefault();
    if (answer.trim()) onReveal(normalizeAnswer(answer) === normalizeAnswer(card.term), hinted);
  }
</script>

<form onsubmit={check} class="space-y-5">
  <ToggleGroup.Root type="single" value={mode} onValueChange={(value) => { if (value) mode = value; }} aria-label="Phrase exercise" variant="outline" class="mx-auto">
    <ToggleGroup.Item value="arrange">Arrange words</ToggleGroup.Item><ToggleGroup.Item value="type">Write it</ToggleGroup.Item>
  </ToggleGroup.Root>
  {#if mode === 'arrange'}
    <div class="min-h-24 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-3 text-left" aria-label="Your sentence">
      {#if !chosen.length}<p class="px-2 py-5 text-center text-sm text-muted-foreground">Tap the words in the right order.</p>{/if}
      <div class="flex flex-wrap gap-2">
        {#each chosen as id (id)}
          {@const tile = tiles.find(item => item.id === id)!}
          <div animate:flip={{ duration: reducedMotion ? 0 : 180 }}><Button variant="outline" lang="de" aria-label={'Remove ' + tile.text} onclick={() => { chosen = chosen.filter(item => item !== id); }}>{tile.text}</Button></div>
        {/each}
      </div>
    </div>
    <div class="flex min-h-20 flex-wrap content-start justify-center gap-2" aria-label="Available words">
      {#each remaining as tile (tile.id)}
        <div animate:flip={{ duration: reducedMotion ? 0 : 180 }}><Button variant="secondary" lang="de" aria-label={'Add ' + tile.text} onclick={() => { chosen = [...chosen, tile.id]; }}>{tile.text}</Button></div>
      {/each}
    </div>
  {:else}
    <Textarea aria-label="Your German answer" lang="de" bind:value={written} rows={3} autocomplete="off" spellcheck={false} placeholder="Write the phrase in German…" />
    <div class="flex justify-center gap-1.5" aria-label="German characters">
      {#each ['ä', 'ö', 'ü', 'ß'] as character}<Button variant="outline" size="xs" aria-label={'Insert ' + character} onclick={() => { written += character; }}>{character}</Button>{/each}
    </div>
  {/if}
  <div class="flex flex-wrap items-center justify-center gap-2">
    <Button type="submit" disabled={!answer.trim()}><CheckIcon class="size-4" />Check answer</Button>
    <Button variant="ghost" onclick={hint}><LightbulbIcon class="size-4" />Hint</Button>
    <Button variant="ghost" onclick={() => onReveal(false, true)}>Show answer</Button>
  </div>
  {#if hinted}<p class="text-xs text-muted-foreground">You used a hint. Choose Hard if you needed help recalling the phrase.</p>{/if}
</form>
