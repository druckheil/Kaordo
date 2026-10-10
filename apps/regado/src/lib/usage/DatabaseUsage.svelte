<script lang="ts">
	// Lists the databases and the largest application tables, marking tables whose cleanup lags
	import type { AdminDataUsage } from '@kaordo/contracts';
	import { TriangleAlertIcon } from '@kaordo/ui';
	import { formatBytes } from '../regado-model';
	import { bloated } from './usage-model';

	let { data }: { data: AdminDataUsage } = $props();
	const number = new Intl.NumberFormat('en');
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="database-usage-title"
>
	<h2 id="database-usage-title" class="text-lg font-semibold">Database</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		A table that grows much faster than its accounts' activity, or piles up dead rows, points at a
		bug in the service that writes it.
	</p>
	<dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
		{#each data.databases as database (database.name)}
			<div class="rounded-xl bg-muted/50 p-3">
				<dt class="text-muted-foreground">{database.name}</dt>
				<dd class="mt-0.5 font-medium">{formatBytes(database.bytes)}</dd>
			</div>
		{/each}
	</dl>
	<div class="mt-4">
		<table class="w-full text-sm">
			<caption class="sr-only">Largest application tables</caption>
			<thead class="text-left text-xs text-muted-foreground">
				<tr>
					<th scope="col" class="py-1.5 pr-3 font-medium">Table</th>
					<th scope="col" class="py-1.5 pr-3 text-right font-medium">Size</th>
					<th scope="col" class="py-1.5 pr-3 text-right font-medium">Rows</th>
					<th scope="col" class="py-1.5 text-right font-medium">Dead rows</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tables as table (table.name)}
					<tr class="border-t border-border">
						<th
							scope="row"
							class="py-1.5 pr-3 text-left font-mono text-xs font-normal [overflow-wrap:anywhere]"
							>{table.name}</th
						>
						<td class="py-1.5 pr-3 text-right tabular-nums">{formatBytes(table.bytes)}</td>
						<td class="py-1.5 pr-3 text-right tabular-nums">{number.format(table.rows)}</td>
						<td
							class={`py-1.5 text-right tabular-nums ${bloated(table) ? 'font-medium text-destructive' : ''}`}
						>
							{#if bloated(table)}<TriangleAlertIcon
									class="mr-1 inline size-3.5 align-[-2px]"
									aria-label="Cleanup lags behind updates"
								/>{/if}{number.format(table.deadRows)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
