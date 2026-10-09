<script lang="ts">
	// Renders the supported safe subset of a shared rich-text document

	import { documentSchema, type FluoDocument } from '@kaordo/contracts';

	let { content }: { content: FluoDocument } = $props();
	const lines = $derived.by(() => {
		const document = documentSchema.safeParse(content);
		if (!document.success) return [];
		return document.data.content
			.map((block) =>
				(block.content ?? []).map((item) => ({
					type: item.type,
					text: item.type === 'text' ? item.text : undefined,
					marks: (item.marks ?? []).map((mark) => mark.type)
				}))
			)
			.filter((line) => line.length > 0);
	});
</script>

<div class="text-[15px] leading-7 break-words sm:text-base">
	{#each lines as line, index (index)}
		<p class="whitespace-pre-wrap empty:min-h-5">
			{#each line as item, itemIndex (itemIndex)}
				{#if item.type === 'hardBreak'}<br />{:else}<span
						class:font-bold={item.marks.includes('bold')}
						class:italic={item.marks.includes('italic')}
						class:line-through={item.marks.includes('strike')}>{item.text}</span
					>{/if}
			{/each}
		</p>
	{/each}
</div>
