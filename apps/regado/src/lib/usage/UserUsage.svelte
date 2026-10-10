<script lang="ts">
	// Ranks accounts by stored bytes, split by application, and flags an unusual week
	import type { AdminDataUsage } from '@kaordo/contracts';
	import { TriangleAlertIcon } from '@kaordo/ui';
	import { formatBytes } from '../regado-model';
	import { appParts, userRows } from './usage-model';

	let { data }: { data: AdminDataUsage } = $props();
	const rows = $derived(userRows(data));
	const largest = $derived(Math.max(1, ...rows.map((row) => row.user.total)));
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="user-usage-title"
>
	<h2 id="user-usage-title" class="text-lg font-semibold">Accounts</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		Uploaded files and encrypted records per account. Content is encrypted on devices, so sizes and
		the application are known, not what a file shows. An account is flagged when it added at least
		512 MiB this week and more than everyone else together.
	</p>
	<ul
		class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
		aria-label="Applications"
	>
		{#each appParts as part (part.key)}
			<li class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-full" style:background={part.color}></span>{part.label}
			</li>
		{/each}
	</ul>
	{#if rows.length === 0}
		<p class="mt-4 text-sm text-muted-foreground">No accounts yet.</p>
	{/if}
	<ol class="mt-4 grid grid-cols-1 gap-3" aria-label="Accounts by size">
		{#each rows as row (row.user.id)}
			<li
				class={`rounded-2xl border p-3 ${row.flagged ? 'border-destructive/40 bg-destructive/5' : 'border-border'}`}
				aria-label={`@${row.user.username}`}
			>
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<p class="min-w-0 truncate text-sm">
						<span class="font-medium">{row.user.displayName || row.user.username}</span>
						<span class="text-muted-foreground"> @{row.user.username}</span>
					</p>
					<p class="text-sm tabular-nums">
						<span class="font-medium">{formatBytes(row.user.total)}</span>
						<span class="text-muted-foreground">
							· {(row.shareOfUsers * 100).toFixed(1)}% · +{formatBytes(row.user.addedWeek)} this week</span
						>
					</p>
				</div>
				<div
					class="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted"
					style:width={`${Math.max(2, (row.user.total / largest) * 100)}%`}
					role="img"
					aria-label={row.parts
						.filter((part) => part.bytes > 0)
						.map((part) => `${part.label} ${formatBytes(part.bytes)}`)
						.join(', ') || 'No stored data'}
				>
					{#each row.parts as part (part.key)}
						{#if part.bytes > 0}
							<span
								style:width={`${(part.bytes / Math.max(1, row.user.total)) * 100}%`}
								style:background={part.color}
							></span>
						{/if}
					{/each}
				</div>
				{#if row.flagged}
					<p class="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
						<TriangleAlertIcon class="size-3.5" />Unusual this week: {formatBytes(
							row.user.addedWeek
						)} added
					</p>
				{/if}
			</li>
		{/each}
	</ol>
</section>
