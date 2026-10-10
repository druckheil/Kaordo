<script lang="ts">
	// Charts each area's size over time, so a line that climbs on its own points at its cause
	import { onMount } from 'svelte';
	import 'uplot/dist/uPlot.min.css';
	import type uPlot from 'uplot';
	import type { HostUsage } from '@kaordo/contracts';
	import { ToggleGroup } from '@kaordo/ui';
	import { formatBytes } from '../regado-model';
	import { categories, usageWindows, type CategoryKey, type UsageWindow } from './usage-model';

	let { usage, window = $bindable() }: { usage: HostUsage; window: UsageWindow } = $props();

	let host = $state<HTMLDivElement>();
	let Plot = $state.raw<typeof uPlot>();
	// The chart instance is imperative; only the module, history and areas drive the effect
	let chart: uPlot | undefined;
	let resizeFrame = 0;
	const keys = $derived(usage.categories.map((category) => category.key as CategoryKey));
	const data = $derived([
		usage.history.map((sample) => Math.floor(new Date(sample.at).getTime() / 1000)),
		...keys.map((key) => usage.history.map((sample) => (sample.bytes[key] ?? 0) / 1024 ** 3))
	] as uPlot.AlignedData);
	const enough = $derived(usage.history.length >= 2);

	onMount(() => {
		let disposed = false;
		void import('uplot').then((module) => {
			if (!disposed) Plot = module.default;
		});
		const sizes = new ResizeObserver(() => {
			if (resizeFrame) return;
			resizeFrame = requestAnimationFrame(() => {
				resizeFrame = 0;
				const width = host?.clientWidth ?? 0;
				if (chart && width > 0 && chart.width !== width) chart.setSize({ width, height: 240 });
			});
		});
		const theme = new MutationObserver(() => chart?.redraw());
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'data-theme']
		});
		if (host) sizes.observe(host);
		return () => {
			disposed = true;
			sizes.disconnect();
			theme.disconnect();
			cancelAnimationFrame(resizeFrame);
			chart?.destroy();
			chart = undefined;
		};
	});

	// The chart appears once there is history; a changed set of areas needs new series, while
	// new samples only replace the data
	let plotted = '';
	$effect(() => {
		const shape = keys.join();
		if (!Plot || !enough) return;
		if (!chart || shape !== plotted) create(Plot);
		else chart.setData(data);
	});

	function create(Plot: typeof uPlot) {
		const element = host;
		if (!element?.clientWidth) return;
		chart?.destroy();
		plotted = keys.join();
		const color = (token: string) => getComputedStyle(element).getPropertyValue(token).trim();
		chart = new Plot(
			{
				width: element.clientWidth,
				height: 240,
				legend: { show: false },
				padding: [12, 8, 2, 8],
				cursor: { drag: { x: false, y: false } },
				scales: { x: { time: true } },
				axes: [
					{
						stroke: () => color('--muted-foreground'),
						grid: { stroke: () => color('--border') }
					},
					{
						label: 'Size (GiB)',
						labelSize: 20,
						size: 56,
						stroke: () => color('--muted-foreground'),
						grid: { stroke: () => color('--border') }
					}
				],
				series: [
					{},
					...keys.map((key) => ({
						label: categories[key].label,
						stroke: categories[key].color,
						width: 2,
						points: { show: false }
					}))
				]
			},
			data,
			element
		);
	}
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="usage-history-title"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="usage-history-title" class="text-lg font-semibold">How it grew</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				One line per area. A system area that climbs while accounts are quiet usually means a
				service writes more than it cleans up.
			</p>
		</div>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			aria-label="History window"
			bind:value={() => window, (value: string) => value && (window = value as UsageWindow)}
		>
			{#each usageWindows as option (option)}
				<ToggleGroup.Item value={option}>{option}</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
	</div>
	{#if !enough}
		<p class="mt-4 text-sm text-muted-foreground" role="status">
			The history fills in as the agent measures every hour.
		</p>
	{/if}
	{#if enough}
		<ul
			class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
			aria-label="Chart lines"
		>
			{#each keys as key (key)}
				<li class="flex items-center gap-1.5">
					<span class="h-0.5 w-3 rounded-full" style:background={categories[key].color}
					></span>{categories[key].label}
				</li>
			{/each}
		</ul>
	{/if}
	<div
		bind:this={host}
		class={`mt-4 min-w-0 ${enough ? '' : 'hidden'}`}
		role="img"
		aria-label={`Size of each area over the last ${window}, latest ${usage.categories
			.map((category) => `${categories[category.key].label} ${formatBytes(category.bytes)}`)
			.join(', ')}`}
	></div>
</section>
