<script lang="ts">
	// Edits push delivery and usage thresholds as a desired state revision and sends a test notice
	import { untrack } from 'svelte';
	import type { HostAlertTest, HostFacts } from '@kaordo/contracts';
	import { Button, Checkbox, CheckIcon, Dialog, Input, Textarea } from '@kaordo/ui';
	import type { StorageState } from './storage-state.svelte';

	let {
		open = $bindable(false),
		facts,
		storage
	}: { open: boolean; facts: HostFacts; storage: StorageState } = $props();

	let push = $state(false);
	let server = $state('');
	let topic = $state('');
	let warning = $state(80);
	let critical = $state(90);
	let reason = $state('');
	let error = $state('');
	let tested = $state<HostAlertTest | null>(null);

	// Each opening starts from the stored settings
	$effect(() => {
		if (!open) return;
		untrack(() => {
			const alerts = facts.desired.alerts;
			push = alerts.ntfy !== null;
			server = alerts.ntfy?.url ?? 'https://ntfy.sh';
			topic = alerts.ntfy?.topic ?? randomTopic();
			warning = alerts.poolWarningPercent;
			critical = alerts.poolCriticalPercent;
			reason = error = '';
			tested = null;
		});
	});

	// ntfy topics are readable by anyone who knows them, so the suggestion is long and random
	function randomTopic(): string {
		const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
		const bytes = crypto.getRandomValues(new Uint8Array(20));
		return 'kaordo-' + Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
	}

	const alerts = $derived({
		poolWarningPercent: warning,
		poolCriticalPercent: critical,
		ntfy: push ? { url: server.trim(), topic: topic.trim() } : null
	});
	const changed = $derived(JSON.stringify(alerts) !== JSON.stringify(facts.desired.alerts));
	const problem = $derived.by(() => {
		if (!(warning >= 50 && warning < critical && critical <= 99))
			return 'Thresholds must satisfy 50 ≤ warning < critical ≤ 99.';
		if (push && !/^https:\/\/[^/@\s]+/.test(server.trim()))
			return 'The ntfy server must be an https address.';
		if (push && !/^[A-Za-z0-9_-]{8,64}$/.test(topic.trim()))
			return 'The topic needs 8 to 64 letters, digits, dashes or underscores.';
		return '';
	});
	const reasonValid = $derived(reason.trim().length <= 500);

	async function save() {
		error = '';
		try {
			await storage.apply.mutateAsync({
				document: { ...$state.snapshot(facts.desired), alerts: $state.snapshot(alerts) },
				confirmations: [],
				reason: reason.trim()
			});
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The settings could not be saved.';
		}
	}

	async function sendTest() {
		error = '';
		tested = null;
		try {
			tested = await storage.testAlerts.mutateAsync();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The test notice could not be sent.';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Notifications</Dialog.Title>
			<Dialog.Description>
				Every alert that opens, becomes critical or resolves is posted once to each administrator's
				Saved messages, and optionally pushed with ntfy.
			</Dialog.Description>
		</Dialog.Header>

		<label class="flex items-center gap-3 text-sm font-semibold">
			<Checkbox.Root
				bind:checked={push}
				class="grid size-5 shrink-0 place-items-center rounded-md border border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
				>{#snippet children({ checked })}{#if checked}<CheckIcon
							class="size-3.5"
						/>{/if}{/snippet}</Checkbox.Root
			>
			Push notifications with ntfy
		</label>
		{#if push}
			<div class="space-y-1">
				<label class="block text-sm font-semibold" for="ntfy-server">Server</label>
				<Input id="ntfy-server" bind:value={server} autocomplete="off" spellcheck="false" />
			</div>
			<div class="space-y-1">
				<label class="block text-sm font-semibold" for="ntfy-topic">Topic</label>
				<Input id="ntfy-topic" bind:value={topic} autocomplete="off" spellcheck="false" />
				<p class="text-xs text-muted-foreground">
					Anyone who knows the topic can read its messages. Subscribe to it in the ntfy app; a token
					for protected topics belongs in Kerno's environment.
				</p>
			</div>
		{/if}

		<fieldset class="grid grid-cols-2 gap-3">
			<legend class="mb-1 text-sm font-semibold">Pool usage alerts</legend>
			<div class="space-y-1">
				<label class="block text-sm" for="pool-warning">Warning at %</label>
				<Input id="pool-warning" type="number" min={50} max={98} bind:value={warning} />
			</div>
			<div class="space-y-1">
				<label class="block text-sm" for="pool-critical">Critical at %</label>
				<Input id="pool-critical" type="number" min={51} max={99} bind:value={critical} />
			</div>
		</fieldset>

		<div class="space-y-1">
			<label class="block text-sm font-semibold" for="notification-reason">Reason</label>
			<Textarea
				id="notification-reason"
				bind:value={reason}
				maxlength={500}
				rows={2}
				placeholder="Optional reason for changing the settings"
			/>
		</div>

		{#if problem}<p class="text-sm text-destructive" role="alert">{problem}</p>{/if}
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
		{#if tested}
			<p class="text-sm" role="status">
				Test notice sent to Saved messages · ntfy: {tested.ntfy}
			</p>
		{/if}
		<Dialog.Footer class="flex-wrap gap-2">
			<Button
				variant="outline"
				disabled={storage.testAlerts.isPending}
				title="Uses the saved settings"
				onclick={sendTest}>{storage.testAlerts.isPending ? 'Sending…' : 'Send test notice'}</Button
			>
			<Button
				disabled={!changed || !!problem || !reasonValid || storage.apply.isPending}
				onclick={save}
			>
				{storage.apply.isPending ? 'Saving…' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
