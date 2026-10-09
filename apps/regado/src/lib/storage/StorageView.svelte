<script lang="ts">
	// Composes the host's pool summary, convergence status, devices, checks, changes and activity
	import { untrack } from 'svelte';
	import type { QueryClient } from '@tanstack/svelte-query';
	import type { AdminApi } from '@kaordo/api-client';
	import { Button, TriangleAlertIcon } from '@kaordo/ui';
	import type { AdminMediaMaintenance } from '@kaordo/contracts';
	import DeviceList from './DeviceList.svelte';
	import IntegrityChecks from './IntegrityChecks.svelte';
	import MediaFiles from './MediaFiles.svelte';
	import OperationList from './OperationList.svelte';
	import PoolChangeDialog from './PoolChangeDialog.svelte';
	import PoolSummary from './PoolSummary.svelte';
	import { createStorageState } from './storage-state.svelte';

	let {
		api,
		queryClient,
		viewerId,
		media,
		mediaDisabled,
		onMediaAction,
		host = 'local'
	}: {
		api: AdminApi;
		queryClient: QueryClient;
		viewerId: string;
		media: AdminMediaMaintenance | null;
		mediaDisabled: boolean;
		onMediaAction: (action: 'check-media' | 'clean-media') => void;
		host?: string;
	} = $props();

	// The API, cache and host are fixed for this view's lifetime
	const storage = untrack(() => createStorageState(api, queryClient, host));
	let changing = $state(false);
	let intent = $state<{ add?: string; remove?: string }>({});
	const facts = $derived(storage.facts.data);
	const busy = $derived(storage.running !== undefined);

	function change(next: { add?: string; remove?: string }) {
		intent = next;
		changing = true;
	}
</script>

<div class="mt-6 grid grid-cols-1 gap-6">
	{#if storage.facts.isPending}
		<p
			class="rounded-[1.4rem] border border-border bg-card p-6 text-sm text-muted-foreground"
			role="status"
		>
			Reading the host's devices…
		</p>
	{:else if storage.facts.isError}
		<div class="rounded-[1.4rem] border border-destructive/35 bg-card p-6">
			<p class="text-sm text-destructive" role="alert">{storage.facts.error.message}</p>
			<Button class="mt-3" variant="outline" size="sm" onclick={() => storage.refresh()}
				>Try again</Button
			>
		</div>
	{:else if facts}
		<PoolSummary {facts} />
		{#if facts.drift.steps.length > 0 || facts.drift.issues.length > 0}
			<section
				class="rounded-[1.4rem] border border-destructive/35 bg-card p-4 sm:p-6"
				aria-labelledby="drift-title"
			>
				<h2 id="drift-title" class="flex items-center gap-2 text-lg font-semibold">
					<TriangleAlertIcon class="size-5 text-destructive" />The host differs from its desired
					state
				</h2>
				<ul class="mt-3 list-disc space-y-1 pl-5 text-sm">
					{#each facts.drift.steps as step, index (index)}<li>Pending: {step.summary}</li>{/each}
					{#each facts.drift.issues as issue (issue)}<li class="text-destructive">
							{issue}
						</li>{/each}
				</ul>
				{#if !busy}
					<Button class="mt-4" variant="outline" size="sm" onclick={() => change({})}
						>Review and apply…</Button
					>
				{:else}
					<p class="mt-3 text-sm text-muted-foreground">An operation is converging the host.</p>
				{/if}
			</section>
		{/if}
		<div class="flex justify-end">
			<Button variant="outline" disabled={busy} onclick={() => change({})}>Change pool…</Button>
		</div>
		<DeviceList {facts} disabled={busy} onChange={change} />
		<PoolChangeDialog bind:open={changing} {facts} {storage} {intent} />
		<IntegrityChecks {facts} {storage} />
	{/if}
	<OperationList {storage} {api} {queryClient} {viewerId} />
	<MediaFiles
		{media}
		disabled={mediaDisabled}
		onCheck={() => onMediaAction('check-media')}
		onClean={() => onMediaAction('clean-media')}
	/>
</div>
