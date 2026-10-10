<script lang="ts">
	// Shows everything in the pool as 100%: each area's share, its growth and the free space left
	import type { HostUsage } from '@kaordo/contracts';
	import { Button, LoaderCircleIcon, TriangleAlertIcon } from '@kaordo/ui';
	import { formatBytes, formatDateTime } from '../regado-model';
	import UsageDonut from './UsageDonut.svelte';
	import { categories, composition, signedBytes } from './usage-model';

	let {
		usage,
		unlinked,
		measuring,
		onMeasure
	}: {
		usage: HostUsage;
		unlinked: number | null;
		measuring: boolean;
		onMeasure: () => void;
	} = $props();

	const parts = $derived(composition(usage));
	// Capacity counts what the pool really stores, which compression can make smaller than the files
	const capacity = $derived(usage.pool.stored + usage.pool.free);
	const usedShare = $derived(capacity > 0 ? usage.pool.stored / capacity : 0);
	let highlighted = $state<string | null>(null);
	const summary = $derived(
		parts.segments
			.map((segment) => `${segment.label} ${(segment.share * 100).toFixed(1)}%`)
			.join(', ')
	);
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="usage-title"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="usage-title" class="text-lg font-semibold">What fills the pool</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				{usage.measuredAt
					? `Measured ${formatDateTime(usage.measuredAt)}; the agent measures every hour.`
					: 'The first measurement is running.'}
			</p>
		</div>
		<Button variant="outline" size="sm" disabled={measuring} onclick={onMeasure}>
			{#if measuring}<LoaderCircleIcon
					class="size-4 motion-safe:animate-spin"
				/>Measuring…{:else}Measure now{/if}
		</Button>
	</div>

	<div class="mt-5 grid items-center gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
		<div class="mx-auto aspect-square w-full max-w-60">
			<UsageDonut
				segments={parts.segments}
				{highlighted}
				label={`Pool contents: ${summary}`}
				total={formatBytes(parts.total)}
				caption="of accounted data"
			/>
		</div>
		<ul class="grid min-w-0 grid-cols-1 gap-1.5" aria-label="Pool contents">
			{#each parts.segments as segment (segment.key)}
				<!-- Name and size share a line; the description and trend use the full width below -->
				<li
					class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-xl px-2 py-1.5 hover:bg-muted/60"
					onpointerenter={() => (highlighted = segment.key)}
					onpointerleave={() => (highlighted = null)}
					aria-label={segment.label}
				>
					<span class="size-3 self-center rounded-full" style:background={segment.color}></span>
					<span class="text-sm font-medium">{segment.label}</span>
					<span class="text-right text-sm font-medium tabular-nums"
						>{formatBytes(segment.bytes)}</span
					>
					<span class="col-start-2 col-end-4 text-xs text-muted-foreground">
						{(segment.share * 100).toFixed(1)}%{segment.growthWeek === null
							? ''
							: ` · ${signedBytes(segment.growthWeek, formatBytes)} this week`} · {categories[
							segment.key
						].description}{segment.key === 'media' && unlinked
							? ` ${formatBytes(unlinked)} are not linked to any content: uploads in progress or awaiting cleanup.`
							: ''}
					</span>
					{#if segment.warning}
						<span
							class="col-start-2 col-end-4 mt-0.5 flex items-center gap-1 text-xs font-medium text-destructive"
						>
							<TriangleAlertIcon class="size-3.5 shrink-0" />{segment.warning}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
	<p class="mt-3 text-xs text-muted-foreground">
		Category sizes count files; compression, shared extents and allocation can affect their disk
		usage. Pool capacity uses the filesystem's reported usage.
	</p>

	<div class="mt-6">
		<div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
			<p>
				<span class="font-semibold">{formatBytes(usage.pool.stored)}</span>
				<span class="text-muted-foreground"> used of {formatBytes(capacity)}</span>
			</p>
			<p class="text-muted-foreground">
				{usage.fullInDays === null
					? 'Not filling up at last week’s pace'
					: `Full in about ${Math.round(usage.fullInDays)} days at last week’s pace`}
			</p>
		</div>
		<!-- The whole capacity: each area's slice, then the free space -->
		<div
			class="mt-2 flex h-3 overflow-hidden rounded-full bg-muted"
			role="img"
			aria-label={`Pool capacity ${(usedShare * 100).toFixed(1)}% used`}
		>
			{#each parts.segments as segment (segment.key)}
				<span style:width={`${segment.share * usedShare * 100}%`} style:background={segment.color}
				></span>
			{/each}
		</div>
		{#if usage.pool.saved > 0}
			<p class="mt-2 text-xs text-muted-foreground">
				Counted file sizes and metadata exceed reported pool usage by {formatBytes(
					usage.pool.saved
				)}. Compression and shared extents can reduce stored usage.
			</p>
		{/if}
	</div>
</section>
