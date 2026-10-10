<script lang="ts">
	// Renders one responsive metric series and reflects the active color theme

	import { onMount } from 'svelte';
	import 'uplot/dist/uPlot.min.css';
	import type uPlot from 'uplot';
	import ContextHelp from './ContextHelp.svelte';

	let {
		title,
		points,
		unit = '%',
		description = ''
	}: {
		title: string;
		points: { time: number; value: number }[];
		unit?: string;
		description?: string;
	} = $props();
	let host: HTMLDivElement;
	let chart = $state.raw<uPlot>();
	let resizeFrame = 0;

	const latest = $derived(points.at(-1)?.value);
	const data = $derived([
		points.map((point) => point.time),
		points.map((point) => point.value)
	] as uPlot.AlignedData);

	onMount(() => {
		let disposed = false;
		const themeObserver = observeTheme();
		const sizeObserver = observeSize();

		void import('uplot').then(({ default: Plot }) => {
			if (!disposed) createChart(Plot);
		});

		return () => {
			disposed = true;
			sizeObserver.disconnect();
			cancelAnimationFrame(resizeFrame);
			themeObserver.disconnect();
			chart?.destroy();
			chart = undefined;
		};
	});

	$effect(() => {
		if (chart) chart.setData(data);
	});

	function observeTheme(): MutationObserver {
		const observer = new MutationObserver(() => chart?.redraw());
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'data-theme']
		});
		return observer;
	}

	function observeSize(): ResizeObserver {
		const observer = new ResizeObserver(() => {
			if (resizeFrame) return;
			// Resize after observation settles; repeated dimensions must not trigger layout again
			resizeFrame = requestAnimationFrame(() => {
				resizeFrame = 0;
				const width = host.clientWidth;
				if (chart && width > 0 && chart.width !== width) {
					chart.setSize({ width, height: 200 });
				}
			});
		});
		observer.observe(host);
		return observer;
	}

	function createChart(Plot: typeof uPlot): void {
		if (!host.clientWidth) return;

		chart = new Plot(createOptions(), data, host);
	}

	function createOptions() {
		return {
			width: host.clientWidth,
			height: 200,
			legend: { show: false },
			padding: [12, 8, 2, 8] as [number, number, number, number],
			cursor: { drag: { x: false, y: false } },
			scales: { x: { time: true } },
			axes: [
				{
					label: 'Time (local)',
					labelSize: 20,
					stroke: () => themeColor('--muted-foreground'),
					grid: { stroke: () => themeColor('--border') }
				},
				{
					label: unit === '%' ? 'Usage (%)' : unit.trim() || 'Tasks',
					labelSize: 20,
					stroke: () => themeColor('--muted-foreground'),
					grid: { stroke: () => themeColor('--border') },
					size: 52
				}
			],
			series: [
				{},
				{
					label: title,
					stroke: () => themeColor('--primary'),
					width: 2,
					points: { show: false }
				}
			]
		};
	}

	function themeColor(token: string): string {
		return getComputedStyle(host).getPropertyValue(token).trim();
	}
</script>

<section
	class="min-w-0 rounded-[1.4rem] border border-border bg-card p-5 shadow-sm"
	aria-label={`${title} history`}
>
	<div class="mb-4 flex items-baseline justify-between gap-3">
		<div class="flex items-center gap-1">
			<h3 class="text-sm font-semibold text-muted-foreground">{title}</h3>
			{#if description}<ContextHelp label={title}
					><p>{description}</p>
					<p>
						The horizontal axis is local time. The vertical axis shows {unit === '%'
							? 'percentage used'
							: unit.trim() || 'the number of runnable or waiting tasks'}. The value above is the
						latest sample.
					</p></ContextHelp
				>{/if}
		</div>
		<strong class="text-2xl font-bold tracking-tight text-foreground"
			>{latest === undefined ? '—' : `${latest.toFixed(unit === '%' ? 1 : 2)}${unit}`}</strong
		>
	</div>
	{#if points.length === 0}<div class="grid h-44 place-items-center text-sm text-muted-foreground">
			Waiting for samples
		</div>{/if}
	<div bind:this={host} class:sr-only={points.length === 0} aria-hidden="true"></div>
</section>
