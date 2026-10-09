<script lang="ts">
	// Arranges calendar event colors in compact geometric clusters
	let { colors = [], journal = false }: { colors?: string[]; journal?: boolean } = $props();
	const visible = $derived(colors.slice(0, 8));
	function position(index: number, count: number): string {
		if (count === 1) return 'left:50%;top:50%';
		if (count === 2) return `left:${index ? 67 : 33}%;top:50%`;
		const angle = (index / count) * Math.PI * 2 - Math.PI / 2 + (count === 4 ? Math.PI / 4 : 0);
		return `left:${50 + Math.cos(angle) * 30}%;top:${50 + Math.sin(angle) * 30}%`;
	}
</script>

<span class="relative block h-5 w-6" aria-hidden="true">
	{#each visible as color, index (index)}<span
			class="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_1px_var(--background)]"
			style={`${position(index, visible.length)};background:${color}`}
		></span>{/each}
	{#if !visible.length && journal}<span
			class="absolute top-1/2 left-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-current opacity-60"
		></span>{/if}
	{#if colors.length > 8}<span class="absolute top-1 -right-3 text-[9px] font-semibold"
			>+{colors.length - 8}</span
		>{/if}
</span>
