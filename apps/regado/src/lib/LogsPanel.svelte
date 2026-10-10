<script lang="ts">
	// Filters, refreshes, and exports service journal entries

	import type { AdminLogs, AdminLogRetentionDays } from '@kaordo/contracts';
	import { Button, Input } from '@kaordo/ui';
	import ContextHelp from './ContextHelp.svelte';
	import {
		filterLogs,
		formatLogTime,
		formatBytes,
		logPriorities,
		logServices,
		logRetentionOptions,
		type LogPriority
	} from './regado-model';

	let {
		logs,
		loading,
		service = $bindable(),
		priority = $bindable(),
		search = $bindable(),
		onRefresh,
		busy,
		onRetentionChange
	}: {
		logs: AdminLogs | null;
		loading: boolean;
		service: string;
		priority: LogPriority;
		search: string;
		onRefresh: () => void;
		busy: boolean;
		onRetentionChange: (days: AdminLogRetentionDays) => void;
	} = $props();

	const visibleLogs = $derived(filterLogs(logs, priority, search));
	const journal = $derived(logs?.journal);
	const currentDays = $derived(journal?.retentionDays);
	let selectedDays = $state<AdminLogRetentionDays>(14);
	$effect(() => {
		const option = logRetentionOptions.find((item) => item.days === currentDays);
		if (option) selectedDays = option.days;
	});

	function downloadLogs(): void {
		if (!logs) return;

		const exportData = {
			service: logs.service,
			exportedAt: new Date().toISOString(),
			items: visibleLogs
		};
		const objectUrl = URL.createObjectURL(
			new Blob([JSON.stringify(exportData, null, 2)], {
				type: 'application/json'
			})
		);
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = `kaordo-${logs.service}-journal.json`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
	}
</script>

<section
	class="mt-6 rounded-[1.4rem] border border-border bg-card p-5 sm:p-6"
	aria-label="Journal storage and retention"
>
	<div class="flex items-center gap-1">
		<h2 class="text-lg font-bold">Journal storage</h2>
		<ContextHelp label="Journal storage"
			><p>
				Usage covers the entire host journal, including system messages and all services. Individual
				services share journal files, so their physical sizes cannot be separated reliably.
			</p>
			<p>
				The retention period and storage budget are enforced by journald. It removes the oldest
				archived files through rotation; recent active files can temporarily exceed the budget.
			</p>
			<p>
				The controls below change host-wide retention. They do not filter just the selected service.
			</p></ContextHelp
		>
	</div>
	<div class="mt-4 grid gap-4 sm:grid-cols-3">
		<div>
			<p class="text-xs text-muted-foreground">Total journal usage</p>
			<p class="mt-1 text-xl font-bold">
				{formatBytes(journal?.totalBytes ?? undefined)}
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Disk {formatBytes(journal?.diskBytes ?? undefined)} · RAM {formatBytes(
					journal?.runtimeBytes ?? undefined
				)}
			</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">Disk-space budget</p>
			<p class="mt-1 text-xl font-bold">
				{journal?.maxUseBytes == null ? 'System default' : formatBytes(journal.maxUseBytes)}
			</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">Current retention</p>
			<p class="mt-1 text-xl font-bold">
				{currentDays == null
					? 'System default'
					: currentDays === 0
						? 'Size limit only'
						: `${currentDays} days`}
			</p>
		</div>
	</div>
	<div class="mt-5 flex flex-wrap items-end gap-3">
		<label class="text-xs font-semibold text-muted-foreground"
			>Log lifetime<select
				class="mt-1 block rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
				bind:value={selectedDays}
				disabled={!journal?.managed || busy}
				aria-label="Log lifetime"
				>{#each logRetentionOptions as option (option.days)}<option value={option.days}
						>{option.label}</option
					>{/each}</select
			></label
		>
		<Button
			variant="outline"
			disabled={!journal?.managed || busy || currentDays === selectedDays}
			onclick={() => onRetentionChange(selectedDays)}>Apply retention</Button
		>
	</div>
	{#if journal && !journal.managed}<p class="mt-3 text-xs text-muted-foreground">
			Retention controls are not enabled on this host.
		</p>{/if}
</section>

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-5 sm:p-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h2 class="text-lg font-bold">Service journal</h2>
			<p class="mt-1 text-sm text-muted-foreground">The latest 80 entries per service.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<label class="text-xs font-semibold text-muted-foreground">
				Service
				<select
					bind:value={service}
					aria-label="Service"
					class="mt-1 block rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
				>
					{#each logServices as logService (logService)}
						<option value={logService}>{logService}</option>
					{/each}
				</select>
			</label>
			<label class="text-xs font-semibold text-muted-foreground">
				Priority
				<select
					bind:value={priority}
					aria-label="Priority"
					class="mt-1 block rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
				>
					{#each logPriorities as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<Button variant="outline" onclick={onRefresh} disabled={loading}>Refresh</Button>
			<Button variant="outline" onclick={downloadLogs} disabled={!logs}>Download JSON</Button>
		</div>
	</div>

	<Input
		class="mt-4"
		bind:value={search}
		placeholder="Filter journal messages"
		aria-label="Filter journal messages"
	/>
	{#if loading}
		<p class="mt-6 text-sm text-muted-foreground" role="status">Loading logs…</p>
	{/if}

	<div
		class="kaordo-scrollbar mt-5 max-h-[60dvh] space-y-1 overflow-auto rounded-xl bg-muted p-3 font-mono text-xs"
	>
		{#each visibleLogs as entry, index (index)}
			<div class="grid gap-1 border-b border-border/70 px-2 py-2 sm:grid-cols-[10rem_1fr]">
				<time class="text-muted-foreground">{formatLogTime(entry.time)}</time>
				<p class="break-all whitespace-pre-wrap">{entry.message}</p>
			</div>
		{:else}
			<p class="p-4 text-muted-foreground">No entries match this filter.</p>
		{/each}
	</div>
</section>
