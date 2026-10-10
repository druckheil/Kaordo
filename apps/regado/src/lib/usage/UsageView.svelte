<script lang="ts">
	// Composes the host's storage measurement with per-account and database usage
	import { untrack } from 'svelte';
	import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
	import { adminDataUsageOptions, adminHostUsageOptions, type AdminApi } from '@kaordo/api-client';
	import { Button } from '@kaordo/ui';
	import DatabaseUsage from './DatabaseUsage.svelte';
	import UsageHistory from './UsageHistory.svelte';
	import UsageOverview from './UsageOverview.svelte';
	import UserUsage from './UserUsage.svelte';
	import { unlinkedMedia, type UsageWindow } from './usage-model';

	let {
		api,
		queryClient,
		host = 'local'
	}: { api: AdminApi; queryClient: QueryClient; host?: string } = $props();

	// The API, cache and host are fixed for this view's lifetime
	const target = untrack(() => ({ api, queryClient, host }));
	let window = $state<UsageWindow>('7d');
	const usage = createQuery(
		() => adminHostUsageOptions(target.api, target.host, window),
		() => target.queryClient
	);
	const data = createQuery(
		() => adminDataUsageOptions(target.api),
		() => target.queryClient
	);
	const measure = createMutation(
		() => ({
			mutationFn: () => target.api.measureHostUsage(target.host),
			onSuccess: () =>
				target.queryClient.invalidateQueries({
					queryKey: ['regado', 'hosts', target.host, 'usage']
				})
		}),
		() => target.queryClient
	);
	const unlinked = $derived(usage.data && data.data ? unlinkedMedia(usage.data, data.data) : null);
</script>

<div class="mt-6 grid grid-cols-1 gap-6">
	{#if usage.isPending}
		<p
			class="rounded-[1.4rem] border border-border bg-card p-6 text-sm text-muted-foreground"
			role="status"
		>
			Reading what fills the pool…
		</p>
	{:else if usage.isError}
		<div class="rounded-[1.4rem] border border-destructive/35 bg-card p-6">
			<p class="text-sm text-destructive" role="alert">{usage.error.message}</p>
			<Button class="mt-3" variant="outline" size="sm" onclick={() => usage.refetch()}
				>Try again</Button
			>
		</div>
	{:else}
		<UsageOverview
			usage={usage.data}
			{unlinked}
			measuring={usage.data.measuring || measure.isPending}
			onMeasure={() => measure.mutate()}
		/>
		<UsageHistory usage={usage.data} bind:window />
	{/if}
	{#if data.isError}
		<p
			class="rounded-[1.4rem] border border-destructive/35 bg-card p-6 text-sm text-destructive"
			role="alert"
		>
			{data.error.message}
		</p>
	{:else if data.data}
		<UserUsage data={data.data} />
		<DatabaseUsage data={data.data} />
	{/if}
</div>
