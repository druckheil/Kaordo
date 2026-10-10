<script lang="ts">
	// Summarizes the host's pool: usable capacity, copies kept and health signals
	import type { HostFacts } from '@kaordo/contracts';
	import { Progress, ServerIcon, ShieldCheckIcon, TriangleAlertIcon } from '@kaordo/ui';
	import { formatBytes } from '../regado-model';
	import { copiesLabel, poolHealth, usableCapacity } from './storage-model';

	let { facts }: { facts: HostFacts } = $props();
	const capacity = $derived(usableCapacity(facts.pool));
	const health = $derived(poolHealth(facts));
	const present = $derived(facts.pool.members.filter((member) => !member.missing).length);
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="pool-summary-title"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="flex items-center gap-3">
			<ServerIcon class="size-6 shrink-0 text-link" />
			<div>
				<h2 id="pool-summary-title" class="text-lg font-semibold">{facts.host.name || 'Host'}</h2>
				<p class="text-sm text-muted-foreground">
					Storage pool at {facts.pool.mount} · {present}
					{present === 1 ? 'device' : 'devices'} · {facts.host.firmware.toUpperCase()} boot
				</p>
			</div>
		</div>
		<p
			class={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${health.level === 'healthy' ? 'bg-primary/10 text-link' : 'bg-destructive/10 text-destructive'}`}
		>
			{#if health.level === 'healthy'}<ShieldCheckIcon class="size-4" />{:else}<TriangleAlertIcon
					class="size-4"
				/>{/if}
			{health.summary}
		</p>
	</div>

	<div class="mt-5">
		<div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
			<p>
				<span class="text-base font-semibold">{formatBytes(capacity.stored)}</span>
				<span class="text-muted-foreground"> stored</span>
			</p>
			<p class="text-muted-foreground">
				{formatBytes(capacity.free)} free of {formatBytes(capacity.total)} usable
			</p>
		</div>
		<Progress
			class="mt-2"
			value={capacity.ratio * 100}
			aria-label={`Pool usage ${(capacity.ratio * 100).toFixed(0)}%`}
		/>
	</div>

	<dl class="mt-5 grid gap-3 text-sm sm:grid-cols-2">
		<div class="rounded-xl bg-muted/50 p-3">
			<dt class="text-muted-foreground">Files and folders</dt>
			<dd class="mt-0.5 font-medium">{copiesLabel(facts.pool.dataProfiles[0])}</dd>
		</div>
		<div class="rounded-xl bg-muted/50 p-3">
			<dt class="text-muted-foreground">Filesystem structure</dt>
			<dd class="mt-0.5 font-medium">{copiesLabel(facts.pool.metadataProfiles[0])}</dd>
		</div>
	</dl>

	{#if health.details.length > 0}
		<ul class="mt-4 space-y-1.5 text-sm" aria-label="Health details">
			{#each health.details as detail (detail)}
				<li class="flex items-start gap-2">
					<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-destructive" />{detail}
				</li>
			{/each}
		</ul>
	{/if}
</section>
