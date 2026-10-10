<script lang="ts">
	// Edits how often each integrity check runs and stores it as a new desired state revision
	import { untrack } from 'svelte';
	import type { HostFacts, HostState } from '@kaordo/contracts';
	import { Button, Dialog, Textarea, ToggleGroup } from '@kaordo/ui';
	import type { StorageState } from './storage-state.svelte';
	import { checks } from './storage-model';

	type Integrity = HostState['integrity'];
	type Frequency = Integrity['scrub'];

	let {
		open = $bindable(false),
		facts,
		storage
	}: { open: boolean; facts: HostFacts; storage: StorageState } = $props();

	let schedule = $state<Integrity>({
		scrub: 'monthly',
		smartShort: 'weekly',
		smartLong: 'monthly'
	});
	let reason = $state('');
	let error = $state('');

	// Each opening starts from the stored schedule
	$effect(() => {
		if (!open) return;
		untrack(() => {
			schedule = { ...facts.desired.integrity };
			reason = error = '';
		});
	});

	const changed = $derived(
		checks.some((check) => schedule[check.setting] !== facts.desired.integrity[check.setting])
	);
	const reasonValid = $derived(reason.trim().length <= 500);

	function choose(setting: keyof Integrity, value: string) {
		// A single toggle group reports an empty value when its pressed item is pressed again
		if (value) schedule[setting] = value as Frequency;
	}

	async function save() {
		error = '';
		try {
			await storage.apply.mutateAsync({
				document: { ...$state.snapshot(facts.desired), integrity: $state.snapshot(schedule) },
				confirmations: [],
				reason: reason.trim()
			});
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The schedule could not be saved.';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Integrity schedule</Dialog.Title>
			<Dialog.Description>
				Monthly verification and weekly short self-tests find failing disks before a second one
				fails.
			</Dialog.Description>
		</Dialog.Header>
		{#each checks as check (check.kind)}
			<div class="space-y-1.5">
				<p class="text-sm font-semibold" id={`schedule-${check.setting}`}>{check.title}</p>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					class="w-full"
					aria-labelledby={`schedule-${check.setting}`}
					bind:value={
						() => schedule[check.setting], (value: string) => choose(check.setting, value)
					}
				>
					<ToggleGroup.Item value="off" class="flex-1">Off</ToggleGroup.Item>
					<ToggleGroup.Item value="weekly" class="flex-1">Weekly</ToggleGroup.Item>
					<ToggleGroup.Item value="monthly" class="flex-1">Monthly</ToggleGroup.Item>
				</ToggleGroup.Root>
			</div>
		{/each}
		<label class="block text-sm font-semibold" for="schedule-reason">Reason</label>
		<Textarea
			id="schedule-reason"
			bind:value={reason}
			maxlength={500}
			rows={3}
			placeholder="Optional reason for changing the schedule"
		/>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
		<Dialog.Footer>
			<Button variant="outline" disabled={storage.apply.isPending} onclick={() => (open = false)}
				>Cancel</Button
			>
			<Button disabled={!changed || !reasonValid || storage.apply.isPending} onclick={save}>
				{storage.apply.isPending ? 'Saving…' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
