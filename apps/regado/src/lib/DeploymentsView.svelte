<script lang="ts">
	// Displays durable release attempts, live transfer progress, rollback results and their journals
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery, type QueryClient } from '@tanstack/svelte-query';
	import {
		adminDeploymentsOptions,
		adminDeploymentOptions,
		type AdminApi
	} from '@kaordo/api-client';
	import type { Deployment } from '@kaordo/contracts';
	import { Button, LoaderCircleIcon, Progress } from '@kaordo/ui';
	import { formatBytes, formatDateTime } from './regado-model';

	let { api, queryClient }: { api: AdminApi; queryClient: QueryClient } = $props();
	const history = createQuery(
		() => adminDeploymentsOptions(api, 'local'),
		() => queryClient
	);
	const selected = $derived.by(() => {
		const value = Number(page.url.searchParams.get('run'));
		return Number.isSafeInteger(value) && value > 0 ? value : (history.data?.items[0]?.run ?? 0);
	});
	const detail = createQuery(
		() => ({
			...adminDeploymentOptions(
				api,
				'local',
				selected,
				history.data?.items.find((item) => item.run === selected)?.attempt
			),
			enabled: selected > 0
		}),
		() => queryClient
	);
	const deployment = $derived(detail.data);
	const active = $derived(deployment?.state === 'waiting' || deployment?.state === 'deploying');
	let now = $state(Date.now());
	$effect(() => {
		if (!active) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const age = $derived(
		deployment
			? Math.max(0, Math.round((now - new Date(deployment.updatedAt).getTime()) / 1000))
			: 0
	);
	const phases: Record<string, string> = {
		queued: 'Waiting for the deployment lock',
		authorization: 'Checking the workflow and revision',
		download: 'Downloading the release',
		verification: 'Verifying the release',
		preflight: 'Checking production',
		snapshots: 'Creating data snapshots',
		configuration: 'Installing configuration sources',
		build: 'Building the NixOS configuration',
		identity_snapshot: 'Saving identity policy',
		activation: 'Activating the system',
		identity: 'Applying identity policy',
		services: 'Checking services and binaries',
		publication: 'Publishing applications',
		live_verification: 'Verifying the live release',
		rollback: 'Restoring the previous release',
		complete: 'Deployment complete'
	};
	const states: Record<Deployment['state'], string> = {
		waiting: 'Waiting',
		deploying: 'Deploying',
		succeeded: 'Succeeded',
		superseded: 'Superseded',
		failed: 'Failed'
	};
	function phase(value: string | undefined): string {
		return value ? (phases[value] ?? value.replaceAll('_', ' ')) : 'Not recorded';
	}
	function choose(run: number): void {
		const url = new URL(page.url);
		url.searchParams.set('run', String(run));
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- Changes only the selection query of the resolved current page
		void goto(url, { noScroll: true, keepFocus: true });
	}
	async function refresh(): Promise<void> {
		await Promise.all([history.refetch(), selected > 0 ? detail.refetch() : Promise.resolve()]);
	}
</script>

<div class="mt-6 space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="max-w-2xl text-sm text-muted-foreground">
			Follow production releases from download through activation and live verification. Each
			release run keeps its latest attempt, failure details and rollback result.
		</p>
		<Button
			variant="outline"
			onclick={() => void refresh()}
			disabled={history.isFetching || detail.isFetching}>Refresh deployments</Button
		>
	</div>
	{#if history.isError || detail.isError}
		<p class="rounded-xl border border-destructive/30 p-4 text-sm text-destructive" role="alert">
			Connection interrupted. {deployment
				? 'The last known deployment status is shown. '
				: ''}{history.error?.message ?? detail.error?.message}
		</p>
	{/if}
	<div class="grid min-w-0 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
		<section
			class="min-w-0 rounded-[1.4rem] border border-border bg-card p-4"
			aria-labelledby="deployment-history"
		>
			<h2 id="deployment-history" class="font-semibold">Release history</h2>
			{#if history.isPending}<p class="mt-3 text-sm text-muted-foreground" role="status">
					Loading deployments…
				</p>
			{:else if history.data?.items.length === 0}<p class="mt-3 text-sm text-muted-foreground">
					No deployments recorded.
				</p>{/if}
			<ul class="mt-3 space-y-2">
				{#each history.data?.items ?? [] as item (item.run)}
					<li>
						<button
							type="button"
							onclick={() => choose(item.run)}
							aria-label={`Deployment ${item.run}`}
							aria-current={selected === item.run ? 'true' : undefined}
							class={`w-full rounded-xl border p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected === item.run ? 'border-primary bg-primary/7' : 'border-border hover:bg-muted/50'}`}
						>
							<span class="block font-semibold"
								>{item.revision?.slice(0, 7) ?? `Run ${item.run}`} · {states[item.state]}</span
							>
							<span class="mt-1 block text-xs text-muted-foreground"
								>Run {item.run} · Attempt {item.attempt ?? 1}</span
							>
							<span class="mt-1 block text-xs text-muted-foreground"
								>{formatDateTime(item.startedAt ?? item.updatedAt)}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		</section>
		<section
			class="min-w-0 rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
			aria-labelledby="deployment-detail"
		>
			<h2 id="deployment-detail" class="text-lg font-semibold">Deployment details</h2>
			{#if selected > 0 && detail.isPending}<p
					class="mt-3 text-sm text-muted-foreground"
					role="status"
				>
					Loading deployment journal…
				</p>
			{:else if !deployment}<p class="mt-3 text-sm text-muted-foreground">
					Select a release to inspect its deployment.
				</p>
			{:else}
				<p class="mt-4 flex items-center gap-2 font-semibold" role="status">
					{#if active}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{/if}{states[
						deployment.state
					]} · {phase(deployment.phase)}
				</p>
				<p class="mt-2 text-sm">{deployment.message}</p>
				{#if active}<p class="mt-2 text-xs text-muted-foreground">
						Server update {age} s ago{age > 20 ? ' · Waiting for a fresh server update.' : ''}
					</p>{/if}
				{#if deployment.progress}
					{@const percent = Math.min(
						100,
						(deployment.progress.receivedBytes / deployment.progress.totalBytes) * 100
					)}
					<Progress class="mt-4" value={percent} aria-label="Artifact download" />
					<p class="mt-2 text-sm text-muted-foreground">
						{formatBytes(deployment.progress.receivedBytes)} / {formatBytes(
							deployment.progress.totalBytes
						)} · {percent.toFixed(0)}%
					</p>
				{/if}
				<dl class="mt-5 grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
					<div>
						<dt class="text-muted-foreground">Run / attempt</dt>
						<dd>{deployment.run} / {deployment.attempt ?? 1}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Started</dt>
						<dd>{formatDateTime(deployment.startedAt)}</dd>
					</div>
					<div class="min-w-0">
						<dt class="text-muted-foreground">Revision</dt>
						<dd class="font-mono text-xs break-all">{deployment.revision ?? 'Not recorded'}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Finished</dt>
						<dd>{formatDateTime(deployment.finishedAt)}</dd>
					</div>
					<div class="min-w-0">
						<dt class="text-muted-foreground">Release</dt>
						<dd class="break-all">{deployment.release ?? 'Not installed'}</dd>
					</div>
					<div class="min-w-0">
						<dt class="text-muted-foreground">Previous release</dt>
						<dd class="break-all">{deployment.previousRelease ?? 'Not recorded'}</dd>
					</div>
				</dl>
				{#if deployment.error}<div
						class="mt-5 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
						role="alert"
					>
						<p class="font-semibold">Failed phase: {phase(deployment.error.phase)}</p>
						<p class="mt-1 break-words">{deployment.error.message}</p>
					</div>{/if}
				<p class="mt-4 text-sm">
					<span class="font-semibold">Rollback:</span>
					{deployment.rollback === 'running'
						? 'In progress'
						: deployment.rollback === 'succeeded'
							? 'Previous release restored'
							: deployment.rollbackFailed || deployment.rollback === 'failed'
								? 'Failed — operator attention required'
								: 'Not needed'}
				</p>
				<a
					class="mt-4 inline-flex min-h-6 items-center text-sm text-link underline underline-offset-4"
					href={`https://github.com/druckheil/Kaordo/actions/runs/${deployment.run}`}
					>Open GitHub Actions run</a
				>
				<h3 class="mt-6 font-semibold">Installation journal</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					The latest 300 entries are retained for each attempt.
				</p>
				{#if !deployment.events?.length}<p class="mt-3 text-sm text-muted-foreground">
						No journal entries were recorded for this attempt.
					</p>
				{:else}<ol
						class="mt-3 max-h-[30rem] space-y-2 overflow-y-auto rounded-xl bg-muted/50 p-3 font-mono text-xs"
						aria-label="Deployment journal"
					>
						{#each deployment.events as event (event.sequence)}<li
								class={event.level === 'error' ? 'text-destructive' : ''}
							>
								<span class="text-muted-foreground">{formatDateTime(event.at)} [{event.phase}]</span
								><span class="mt-1 block break-all whitespace-pre-wrap">{event.message}</span>
							</li>{/each}
					</ol>{/if}
			{/if}
		</section>
	</div>
</div>
