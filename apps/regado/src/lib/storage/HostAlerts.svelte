<script lang="ts">
	// Lists the host's open alerts and recent resolutions and opens the notification settings
	import type { HostFacts } from '@kaordo/contracts';
	import { BellIcon, Button, ShieldCheckIcon, TriangleAlertIcon } from '@kaordo/ui';
	import { formatDateTime } from '../regado-model';
	import NotificationSettings from './NotificationSettings.svelte';
	import type { StorageState } from './storage-state.svelte';

	let { facts, storage }: { facts: HostFacts; storage: StorageState } = $props();

	const all = $derived(storage.alerts.data?.alerts ?? []);
	const open = $derived(all.filter((alert) => !alert.resolvedAt));
	const resolved = $derived(all.filter((alert) => alert.resolvedAt).slice(0, 5));
	let configuring = $state(false);
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="alerts-title"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="alerts-title" class="text-lg font-semibold">Alerts</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				{facts.desired.alerts.ntfy
					? `Administrators get each change in Saved messages and on ntfy topic ${facts.desired.alerts.ntfy.topic}.`
					: 'Administrators get each change in Saved messages. Push notifications are off.'}
			</p>
		</div>
		<Button variant="outline" size="sm" onclick={() => (configuring = true)}
			><BellIcon class="size-4" />Notifications…</Button
		>
	</div>
	{#if storage.alerts.isError}
		<p class="mt-3 text-sm text-destructive" role="alert">{storage.alerts.error.message}</p>
	{:else if storage.alerts.isSuccess && open.length === 0}
		<p class="mt-4 flex items-center gap-2 text-sm">
			<ShieldCheckIcon class="size-4 text-link" />No open alerts.
		</p>
	{/if}
	{#if open.length > 0}
		<ul class="mt-4 grid grid-cols-1 gap-2" aria-label="Open alerts">
			{#each open as alert (alert.key)}
				<li
					class={`flex items-start gap-3 rounded-2xl border p-3 text-sm ${alert.severity === 'critical' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/40 bg-amber-500/5'}`}
				>
					<TriangleAlertIcon
						class={`mt-0.5 size-4 shrink-0 ${alert.severity === 'critical' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'}`}
					/>
					<div class="min-w-0">
						<p class="font-medium">{alert.summary}</p>
						<p class="text-muted-foreground">
							{alert.severity === 'critical' ? 'Critical' : 'Warning'} · since {formatDateTime(
								alert.firstSeen
							)}
						</p>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	{#if resolved.length > 0}
		<details class="mt-4 text-sm">
			<summary class="min-h-6 cursor-pointer py-0.5 text-muted-foreground"
				>Recently resolved</summary
			>
			<ul class="mt-2 space-y-1.5">
				{#each resolved as alert (alert.key)}
					<li>
						{alert.summary}
						<span class="text-muted-foreground">· resolved {formatDateTime(alert.resolvedAt)}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<NotificationSettings bind:open={configuring} {facts} {storage} />
