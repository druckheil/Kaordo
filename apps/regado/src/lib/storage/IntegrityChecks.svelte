<script lang="ts">
	// Shows each integrity check's schedule and latest result and starts a check on request
	import type { HostFacts, HostOperation } from '@kaordo/contracts';
	import { Button, Dialog, Textarea } from '@kaordo/ui';
	import { formatDateTime } from '../regado-model';
	import IntegritySchedule from './IntegritySchedule.svelte';
	import type { StorageState } from './storage-state.svelte';
	import { checkHistory, checks, currentStep, type CheckKind } from './storage-model';

	let { facts, storage }: { facts: HostFacts; storage: StorageState } = $props();

	const history = $derived(checkHistory(storage.operations.data?.items ?? []));
	const frequencies: Record<string, string> = { off: 'Off', weekly: 'Weekly', monthly: 'Monthly' };
	const outcomes: Record<string, string> = {
		queued: 'Queued',
		running: 'Running',
		succeeded: 'Passed',
		failed: 'Failed',
		cancelled: 'Cancelled',
		interrupted: 'Interrupted',
		skipped: 'Skipped'
	};
	const descriptions: Record<CheckKind, string> = {
		'integrity.scrub':
			'Reads stored data and metadata across the entire pool, including the operating system, Nix store, databases and media, and verifies their available checksums. A damaged copy is rewritten from a good one. Data without checksums is checked for read errors only. Services stay available, with disk reads limited while it runs.',
		'integrity.smart-short':
			'Each pool disk tests its own electronics and a sample of its surface. It takes a few minutes per disk.',
		'integrity.smart-long':
			'Each pool disk reads its entire surface, which takes hours on large disks. The disks stay usable but slower.'
	};

	let requested = $state<CheckKind | null>(null);
	let reason = $state('');
	let error = $state('');
	let scheduling = $state(false);
	const reasonValid = $derived(reason.trim().length <= 500);

	function status(last: HostOperation | undefined): string {
		if (!last) return 'Not run yet';
		const step = last.state === 'running' ? currentStep(last) : undefined;
		if (step) {
			const where = step.count > 1 ? ` · disk ${step.number} of ${step.count}` : '';
			const done = step.percent === undefined ? '' : ` · ${step.percent.toFixed(0)}%`;
			return `Running${where}${done}`;
		}
		return `${outcomes[last.state]} ${formatDateTime(last.finishedAt ?? last.createdAt)}`;
	}

	function request(kind: CheckKind) {
		requested = kind;
		reason = error = '';
	}

	async function run() {
		if (!requested) return;
		error = '';
		try {
			await storage.startCheck.mutateAsync({ kind: requested, reason: reason.trim() });
			requested = null;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The check could not start.';
		}
	}
</script>

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="integrity-title"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="integrity-title" class="text-lg font-semibold">Integrity checks</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Scheduled checks start between 02:00 and 06:00 server time, one at a time.
			</p>
			<p class="mt-1 text-sm text-muted-foreground">
				Verification covers the entire storage pool, including system files and databases even when
				there are no media uploads.
			</p>
		</div>
		<Button variant="outline" size="sm" onclick={() => (scheduling = true)}>Change schedule…</Button
		>
	</div>
	<ul class="mt-4 grid grid-cols-1 gap-3">
		{#each checks as check (check.kind)}
			{@const last = history.last[check.kind]}
			<li
				class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4"
				aria-label={check.title}
			>
				<div class="min-w-0">
					<p class="font-medium">{check.title}</p>
					<p class="text-sm text-muted-foreground">
						{frequencies[facts.desired.integrity[check.setting]]} · {status(last)}
					</p>
					{#if last?.error}<p class="text-sm text-destructive">{last.error}</p>{/if}
				</div>
				<Button
					variant="outline"
					size="sm"
					disabled={history.running}
					onclick={() => request(check.kind)}>Run now</Button
				>
			</li>
		{/each}
	</ul>
</section>

<IntegritySchedule bind:open={scheduling} {facts} {storage} />

<Dialog.Root
	open={requested !== null}
	onOpenChange={(open) => {
		if (!open && !storage.startCheck.isPending) requested = null;
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{checks.find((check) => check.kind === requested)?.title}</Dialog.Title>
			<Dialog.Description>{requested ? descriptions[requested] : ''}</Dialog.Description>
		</Dialog.Header>
		<label class="block text-sm font-semibold" for="check-reason">Reason</label>
		<Textarea
			id="check-reason"
			bind:value={reason}
			maxlength={500}
			rows={3}
			placeholder="Optional reason for running the check now"
		/>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
		<Dialog.Footer>
			<Button
				variant="outline"
				disabled={storage.startCheck.isPending}
				onclick={() => (requested = null)}>Cancel</Button
			>
			<Button disabled={!reasonValid || storage.startCheck.isPending} onclick={run}>
				{storage.startCheck.isPending ? 'Starting…' : 'Run now'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
