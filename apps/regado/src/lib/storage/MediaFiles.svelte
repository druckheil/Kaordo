<script lang="ts">
	// Reports Nodo's latest media audit and offers an audited check or cleanup
	import type { AdminMediaMaintenance } from '@kaordo/contracts';
	import { Button, LoaderCircleIcon, Progress } from '@kaordo/ui';
	import { formatBytes, formatDateTime } from '../regado-model';

	let {
		media,
		disabled,
		onCheck,
		onClean
	}: {
		media: AdminMediaMaintenance | null;
		disabled: boolean;
		onCheck: () => void;
		onClean: () => void;
	} = $props();

	const running = $derived(media?.state === 'checking' || media?.state === 'repairing');
	const percent = $derived(
		media?.progress?.total ? (media.progress.completed / media.progress.total) * 100 : undefined
	);
	const files = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}`;
	const stages: Record<string, string> = {
		inventory: 'Counting stored files',
		references: 'Checking references',
		complete: 'Complete'
	};
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="media-files-title"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="media-files-title" class="text-lg font-semibold">Media files</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Uploads that nothing references are removed automatically a day after upload. A check counts
				stored files and finds missing previews.
			</p>
		</div>
		<div class="flex gap-2">
			<Button variant="outline" size="sm" disabled={disabled || running || !media} onclick={onCheck}
				>Check</Button
			>
			<Button variant="outline" size="sm" disabled={disabled || running || !media} onclick={onClean}
				>Clean up</Button
			>
		</div>
	</div>

	{#if !media}
		<p class="mt-4 text-sm text-muted-foreground">Media status is unavailable.</p>
	{:else if running}
		<p class="mt-4 flex items-center gap-2 text-sm" role="status">
			<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />
			{media.state === 'repairing' ? 'Cleaning up' : 'Checking'} · {stages[media.stage ?? ''] ??
				'Starting'}
		</p>
		{#if percent !== undefined}
			<Progress class="mt-2" value={percent} aria-label={`Media check ${percent.toFixed(0)}%`} />
		{/if}
	{:else if media.checkedAt}
		<dl class="mt-4 grid gap-3 text-sm sm:grid-cols-3">
			<div class="rounded-xl bg-muted/50 p-3">
				<dt class="text-muted-foreground">Stored</dt>
				<dd class="mt-0.5 font-medium">
					{files(media.files)} · {formatBytes(media.bytes)}
				</dd>
			</div>
			<div class="rounded-xl bg-muted/50 p-3">
				<dt class="text-muted-foreground">Unused</dt>
				<dd class="mt-0.5 font-medium">
					{files(media.surplusFiles)} · {formatBytes(media.surplusBytes)}
				</dd>
			</div>
			<div class="rounded-xl bg-muted/50 p-3">
				<dt class="text-muted-foreground">Missing previews</dt>
				<dd class="mt-0.5 font-medium">{media.missingFiles.toLocaleString()}</dd>
			</div>
		</dl>
		<p class="mt-3 text-xs text-muted-foreground">
			Checked {formatDateTime(media.checkedAt)}{media.removedFiles > 0
				? ` · ${files(media.removedFiles)} (${formatBytes(media.removedBytes)}) removed`
				: ''}{media.unverifiedFiles > 0
				? ` · ${files(media.unverifiedFiles)} could not be verified and kept`
				: ''}
		</p>
		{#if media.error}<p class="mt-2 text-sm text-destructive" role="alert">{media.error}</p>{/if}
	{:else}
		<p class="mt-4 text-sm text-muted-foreground">No check has run since Nodo started.</p>
	{/if}
</section>
