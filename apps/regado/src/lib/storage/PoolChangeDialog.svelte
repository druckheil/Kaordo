<script lang="ts">
	// Edits the desired pool, previews the agent's plan and applies it with confirmations and a reason
	import { untrack } from 'svelte';
	import type { HostFacts, HostPoolPlan, HostState } from '@kaordo/contracts';
	import {
		Button,
		Checkbox,
		CheckIcon,
		Dialog,
		Input,
		LoaderCircleIcon,
		RadioGroup,
		Textarea,
		TriangleAlertIcon
	} from '@kaordo/ui';
	import { formatBytes, minimumReasonLength } from '../regado-model';
	import type { StorageState } from './storage-state.svelte';
	import {
		classLabels,
		copiesLabel,
		dataProfilesFor,
		deviceLabel,
		eligibleForPool
	} from './storage-model';

	let {
		open = $bindable(false),
		facts,
		storage,
		intent
	}: {
		open: boolean;
		facts: HostFacts;
		storage: StorageState;
		intent: { add?: string; remove?: string };
	} = $props();

	let selected = $state<string[]>([]);
	let dataProfile = $state<HostState['pool']['dataProfile']>('raid1');
	let plan = $state<HostPoolPlan | null>(null);
	let planError = $state('');
	let planning = $state(false);
	let typed = $state<Record<string, string>>({});
	let reason = $state('');
	let applyError = $state('');

	// Each opening starts from the stored desired state plus the requested change
	$effect(() => {
		if (!open) return;
		untrack(() => {
			const kept = facts.desired.pool.devices.filter((id) => id !== intent.remove);
			selected = intent.add && !kept.includes(intent.add) ? [...kept, intent.add] : kept;
			dataProfile = facts.desired.pool.dataProfile;
			plan = null;
			planError = applyError = reason = '';
			typed = {};
		});
	});

	const present = $derived(new Set(facts.devices.map((device) => device.id)));
	const candidates = $derived([
		...facts.desired.pool.devices.map((id) => ({
			id,
			device: facts.devices.find((item) => item.id === id)
		})),
		...facts.devices
			.filter(
				(device) => !facts.desired.pool.devices.includes(device.id) && eligibleForPool(device)
			)
			.map((device) => ({ id: device.id, device }))
	]);
	const profiles = $derived(dataProfilesFor(selected.length));
	const effectiveProfile = $derived(profiles.includes(dataProfile) ? dataProfile : profiles[0]);
	const document = $derived<HostState>({
		...facts.desired,
		pool: { ...facts.desired.pool, devices: selected, dataProfile: effectiveProfile }
	});
	const confirmations = $derived(
		(plan?.steps ?? []).flatMap((step) => (step.confirm ? [step.confirm] : []))
	);
	const confirmed = $derived(confirmations.every((serial) => typed[serial] === serial));
	const reasonValid = $derived(
		reason.trim().length >= minimumReasonLength && reason.trim().length <= 500
	);
	const canApply = $derived(
		!!plan &&
			plan.issues.length === 0 &&
			plan.steps.length > 0 &&
			confirmed &&
			reasonValid &&
			!storage.apply.isPending
	);

	// Preview the plan shortly after the selection settles
	$effect(() => {
		if (!open || selected.length === 0) return;
		const draft = $state.snapshot(document);
		planning = true;
		const timer = setTimeout(() => {
			storage
				.plan(draft)
				.then((result) => {
					if (result) {
						plan = result;
						planError = '';
					}
				})
				.catch((error: unknown) => {
					plan = null;
					planError = error instanceof Error ? error.message : 'The plan could not be prepared.';
				})
				.finally(() => (planning = false));
		}, 250);
		return () => clearTimeout(timer);
	});

	function toggle(id: string, checked: boolean) {
		selected = checked ? [...selected, id] : selected.filter((item) => item !== id);
	}

	async function apply() {
		applyError = '';
		try {
			await storage.apply.mutateAsync({
				document: $state.snapshot(document),
				confirmations,
				reason: reason.trim(),
				// The pool dialog also finishes drift when the selection is unchanged
				converge: true
			});
			open = false;
		} catch (error) {
			applyError = error instanceof Error ? error.message : 'The change could not be applied.';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Change the storage pool</Dialog.Title>
			<Dialog.Description>
				Choose the devices that hold the pool. Kaordo plans the steps, and nothing changes until you
				apply.
			</Dialog.Description>
		</Dialog.Header>

		<fieldset class="space-y-2">
			<legend class="text-sm font-semibold">Devices</legend>
			{#each candidates as candidate (candidate.id)}
				{@const checked = selected.includes(candidate.id)}
				<label
					class="flex items-start gap-3 rounded-xl border border-border p-3 has-data-[state=checked]:border-primary/50"
				>
					<Checkbox.Root
						{checked}
						onCheckedChange={(value) => toggle(candidate.id, value)}
						aria-label={candidate.device ? deviceLabel(candidate.device) : candidate.id}
						class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
						>{#snippet children({ checked })}{#if checked}<CheckIcon
									class="size-3.5"
								/>{/if}{/snippet}</Checkbox.Root
					>
					<span class="min-w-0 text-sm">
						<span class="block truncate font-medium">{candidate.device?.model || candidate.id}</span
						>
						<span class="block truncate text-muted-foreground">
							{#if candidate.device}
								{formatBytes(candidate.device.size)} · {classLabels[candidate.device.class]}
							{:else if !present.has(candidate.id)}
								Missing · uncheck it to rebuild or drop its copies
							{/if}
						</span>
					</span>
				</label>
			{/each}
		</fieldset>

		{#if profiles.length > 1}
			<fieldset class="space-y-2">
				<legend class="text-sm font-semibold">Copies of files</legend>
				<RadioGroup.Root
					value={effectiveProfile}
					onValueChange={(value) => (dataProfile = value as HostState['pool']['dataProfile'])}
					class="grid gap-2 sm:grid-cols-2"
				>
					{#each profiles as profile (profile)}
						<label class="flex items-center gap-2 rounded-xl border border-border p-3 text-sm">
							<RadioGroup.Item value={profile} />{copiesLabel(profile)}
						</label>
					{/each}
				</RadioGroup.Root>
			</fieldset>
		{/if}

		<section class="space-y-2" aria-labelledby="pool-plan-title" aria-busy={planning}>
			<h3 id="pool-plan-title" class="flex items-center gap-2 text-sm font-semibold">
				Planned steps{#if planning}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{/if}
			</h3>
			{#if selected.length === 0}
				<p class="text-sm text-muted-foreground">Select at least one device.</p>
			{:else if planError}
				<p role="alert" class="text-sm text-destructive">{planError}</p>
			{:else if plan}
				{#if plan.steps.length === 0 && plan.issues.length === 0}
					<p class="text-sm text-muted-foreground">The pool already matches this selection.</p>
				{/if}
				<ol class="list-decimal space-y-1 pl-5 text-sm">
					{#each plan.steps as step, index (index)}
						<li>{step.summary}</li>
					{/each}
				</ol>
				{#each plan.issues as issue (issue)}
					<p class="flex items-start gap-2 text-sm text-destructive">
						<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />{issue}
					</p>
				{/each}
			{/if}
		</section>

		{#each confirmations as serial (serial)}
			<div class="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
				<p class="text-sm font-semibold text-destructive">This erases everything on the device</p>
				<label class="block text-sm" for={`erase-${serial}`}>
					Type <span class="font-mono font-semibold">{serial}</span> to confirm
				</label>
				<Input
					id={`erase-${serial}`}
					bind:value={typed[serial]}
					autocomplete="off"
					spellcheck="false"
				/>
			</div>
		{/each}

		<div class="space-y-1">
			<label class="block text-sm font-semibold" for="pool-change-reason">Reason</label>
			<Textarea
				id="pool-change-reason"
				bind:value={reason}
				maxlength={500}
				rows={3}
				placeholder="Why the pool changes, for the audit log"
			/>
			<p class="text-xs text-muted-foreground">
				{reason.trim().length}/500 characters · {minimumReasonLength} minimum
			</p>
		</div>

		{#if applyError}
			<p
				class="rounded-xl border border-destructive/30 bg-destructive/7 p-3 text-sm text-destructive"
				role="alert"
			>
				{applyError}
			</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" disabled={storage.apply.isPending} onclick={() => (open = false)}
				>Cancel</Button
			>
			<Button disabled={!canApply} onclick={apply}>
				{storage.apply.isPending ? 'Applying…' : 'Apply'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
