<script lang="ts">
	// Loads one operation's log when an administrator expands it
	import { createQuery, type QueryClient } from '@tanstack/svelte-query';
	import { adminHostOperationOptions, type AdminApi } from '@kaordo/api-client';

	let {
		api,
		queryClient,
		host,
		operation,
		running
	}: {
		api: AdminApi;
		queryClient: QueryClient;
		host: string;
		operation: string;
		running: boolean;
	} = $props();

	const record = createQuery(
		() => ({
			...adminHostOperationOptions(api, host, operation),
			refetchInterval: running ? 5_000 : false
		}),
		() => queryClient
	);
	const time = new Intl.DateTimeFormat('en', { timeStyle: 'medium' });
</script>

{#if record.isPending}
	<p class="text-sm text-muted-foreground" role="status">Loading the log…</p>
{:else if record.isError}
	<p class="text-sm text-destructive" role="alert">{record.error.message}</p>
{:else if record.data.log.length === 0}
	<p class="text-sm text-muted-foreground">No log entries.</p>
{:else}
	<ol
		class="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-muted/50 p-3 font-mono text-xs"
		aria-label="Operation log"
	>
		{#each record.data.log as entry, index (index)}
			<li>
				<span class="text-muted-foreground">{time.format(new Date(entry.at))}</span>
				{entry.message}
			</li>
		{/each}
	</ol>
{/if}
