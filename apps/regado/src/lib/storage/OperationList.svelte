<script lang="ts">
	// Shows recent host operations with stage progress, cancellation and logs
	import type { QueryClient } from '@tanstack/svelte-query';
	import type { AdminApi } from '@kaordo/api-client';
	import type { HostOperation } from '@kaordo/contracts';
	import { Button, LoaderCircleIcon, Progress } from '@kaordo/ui';
	import OperationLog from './OperationLog.svelte';
	import type { StorageState } from './storage-state.svelte';
	import { operationTitle, stageProgress } from './storage-model';

	let {
		storage,
		api,
		queryClient,
		viewerId
	}: { storage: StorageState; api: AdminApi; queryClient: QueryClient; viewerId: string } =
		$props();

	let expanded = $state<string | null>(null);
	const operations = $derived(storage.operations.data?.items ?? []);
	const anyActive = $derived(
		operations.some((item) => item.state === 'running' || item.state === 'queued')
	);
	// A ticking clock shows how fresh the five-second status is while work runs
	let now = $state(Date.now());
	$effect(() => {
		if (!anyActive) return;
		const timer = setInterval(() => (now = Date.now()), 1_000);
		return () => clearInterval(timer);
	});
	const updatedSeconds = $derived(
		Math.max(0, Math.round((now - storage.operations.dataUpdatedAt) / 1_000))
	);
	function freshness(percent: number | undefined): string {
		const updated = `Updated ${updatedSeconds} s ago`;
		return percent === undefined ? updated : `${percent.toFixed(0)}% · ${updated}`;
	}
	const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
	const stateLabels: Record<HostOperation['state'], string> = {
		queued: 'Queued',
		running: 'Running',
		succeeded: 'Done',
		failed: 'Failed',
		cancelled: 'Cancelled',
		interrupted: 'Interrupted',
		skipped: 'Skipped'
	};

	function requester(operation: HostOperation): string {
		if (operation.requestedBy === 'schedule') return 'Scheduled';
		if (operation.requestedBy === 'agent') return 'Automatic';
		return operation.requestedBy === viewerId ? 'You' : 'Another administrator';
	}
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="operations-title"
>
	<h2 id="operations-title" class="text-lg font-semibold">Activity</h2>
	{#if storage.operations.isError}
		<p class="mt-3 text-sm text-destructive" role="alert">{storage.operations.error.message}</p>
	{:else if operations.length === 0}
		<p class="mt-3 text-sm text-muted-foreground">No operations yet.</p>
	{/if}
	<ul class="mt-4 grid grid-cols-1 gap-3">
		{#each operations as operation (operation.id)}
			{@const active = operation.state === 'running' || operation.state === 'queued'}
			<li class="rounded-2xl border border-border p-4" aria-label={operationTitle(operation)}>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="flex items-center gap-2 font-medium">
							{#if active}<LoaderCircleIcon
									class="size-4 motion-safe:animate-spin"
								/>{/if}{operationTitle(operation)}
						</p>
						<p class="text-sm text-muted-foreground">
							{stateLabels[operation.state]} · {requester(operation)} · {date.format(
								new Date(operation.createdAt)
							)}
						</p>
						{#if operation.reason}<p class="mt-1 text-sm">{operation.reason}</p>{/if}
					</div>
					<div class="flex gap-2">
						{#if active && operation.cancellable}
							<Button
								variant="outline"
								size="sm"
								disabled={storage.cancel.isPending}
								onclick={() => storage.cancel.mutate(operation.id)}>Cancel</Button
							>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							aria-expanded={expanded === operation.id}
							onclick={() => (expanded = expanded === operation.id ? null : operation.id)}
							>{expanded === operation.id ? 'Hide log' : 'Show log'}</Button
						>
					</div>
				</div>
				<ol class="mt-3 space-y-2">
					{#each operation.stages as stage, index (index)}
						{@const percent = stageProgress(stage)}
						<li class="text-sm">
							<p
								class={stage.state === 'failed'
									? 'text-destructive'
									: stage.state === 'queued' || stage.state === 'skipped'
										? 'text-muted-foreground'
										: ''}
							>
								{stage.name}<span class="text-muted-foreground"> · {stateLabels[stage.state]}</span>
							</p>
							{#if stage.detail && stage.state === 'running'}<p
									class="text-xs text-muted-foreground"
								>
									{stage.detail}
								</p>{/if}
							{#if percent !== undefined && stage.state === 'running'}
								<Progress
									class="mt-1"
									value={percent}
									aria-label={`${stage.name} ${percent.toFixed(0)}%`}
								/>
							{/if}
							{#if stage.state === 'running'}
								<p class="mt-1 text-xs text-muted-foreground">{freshness(percent)}</p>
							{/if}
						</li>
					{/each}
				</ol>
				{#if operation.error}
					<p class="mt-3 text-sm text-destructive" role="alert">{operation.error}</p>
				{/if}
				{#if expanded === operation.id}
					<div class="mt-3">
						<OperationLog
							{api}
							{queryClient}
							host={storage.host}
							operation={operation.id}
							running={active}
						/>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</section>
