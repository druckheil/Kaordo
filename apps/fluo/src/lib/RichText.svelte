<script lang="ts">
  import type { FluoDocument } from '@kaordo/contracts';

  let { content }: { content: FluoDocument } = $props();
  type Inline = { type: 'text' | 'hardBreak'; text?: string; marks: string[] };
  function paragraphs(doc: FluoDocument): Inline[][] {
    return (doc.content ?? []).map((block) => {
      if (!block || block.type !== 'paragraph' || !Array.isArray(block.content)) return [];
      const line: Inline[] = [];
      for (const item of block.content) {
        if (!item || typeof item !== 'object') continue;
        const value = item as { type?: string; text?: string; marks?: { type?: string }[] };
        if (value.type !== 'text' && value.type !== 'hardBreak') continue;
        line.push({ type: value.type, text: value.text, marks: value.marks?.map((mark) => mark.type ?? '') ?? [] });
      }
      return line;
    });
  }
  const lines = $derived(paragraphs(content));
</script>

<div class="break-words text-sm leading-6">
  {#each lines as line}
    <p class="whitespace-pre-wrap empty:min-h-5">
      {#each line as item}
        {#if item.type === 'hardBreak'}<br />{:else}<span class:font-bold={item.marks.includes('bold')} class:italic={item.marks.includes('italic')} class:line-through={item.marks.includes('strike')}>{item.text}</span>{/if}
      {/each}
    </p>
  {/each}
</div>
