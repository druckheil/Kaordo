<script lang="ts">
	// Draws the pool's contents as a ring of shares, with the total in the middle
	import type { Segment } from './usage-model';

	let {
		segments,
		label,
		total,
		caption,
		highlighted = null
	}: {
		segments: Segment[];
		label: string;
		total: string;
		caption: string;
		highlighted?: string | null;
	} = $props();

	const radius = 80;
	const circumference = 2 * Math.PI * radius;
	// Each arc starts where the previous one ended; a hairline gap keeps neighbours apart
	const arcs = $derived.by(() => {
		let offset = 0;
		return segments
			.filter((segment) => segment.share > 0)
			.map((segment) => {
				const length = Math.max(segment.share * circumference - 1.5, 0.75);
				const arc = { segment, length, offset };
				offset += segment.share * circumference;
				return arc;
			});
	});
</script>

<svg viewBox="0 0 200 200" class="size-full" role="img" aria-label={label}>
	<circle cx="100" cy="100" r={radius} fill="none" stroke="var(--muted)" stroke-width="26" />
	<g transform="rotate(-90 100 100)">
		{#each arcs as arc (arc.segment.key)}
			<circle
				cx="100"
				cy="100"
				r={radius}
				fill="none"
				stroke={arc.segment.color}
				stroke-width={highlighted === arc.segment.key ? 32 : 26}
				stroke-dasharray={`${arc.length} ${circumference - arc.length}`}
				stroke-dashoffset={-arc.offset}
				opacity={highlighted && highlighted !== arc.segment.key ? 0.35 : 1}
				class="motion-safe:transition-[opacity,stroke-width]"
			/>
		{/each}
	</g>
	<text x="100" y="96" text-anchor="middle" class="fill-foreground text-[22px] font-bold"
		>{total}</text
	>
	<text x="100" y="118" text-anchor="middle" class="fill-muted-foreground text-[11px]"
		>{caption}</text
	>
</svg>
