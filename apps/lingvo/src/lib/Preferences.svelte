<script lang="ts">
	// Saves per-dictionary review goals and the time zone used for daily activity
	import { onDestroy, untrack } from 'svelte';
	import type { LingvoDictionary } from '@kaordo/contracts';
	import {
		Button,
		Dialog,
		Input,
		LoaderCircleIcon,
		RadioGroup,
		Slider,
		TargetIcon
	} from '@kaordo/ui';
	import { errorMessage, getLingvoContext } from './lingvo-context';

	let { dictionary, onClose }: { dictionary: LingvoDictionary; onClose(this: void): void } =
		$props();
	const { api, queryClient, changed, notify } = getLingvoContext();
	const id = $props.id();
	let goal = $state(untrack(() => dictionary.dailyGoal));
	let timeZone = $state(untrack(() => dictionary.timeZone));
	let busy = $state(false);
	let error = $state('');
	let disposed = false;
	const abort = new AbortController();
	onDestroy(() => {
		disposed = true;
		abort.abort();
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			await api.settings(
				dictionary.id,
				{ dailyGoal: goal, timeZone: timeZone.trim() },
				abort.signal
			);
			if (disposed) return;
			void changed(dictionary.id);
			void queryClient.invalidateQueries({ queryKey: ['lingvo', 'dictionaries'] });
			notify('Learning preferences saved.');
			onClose();
		} catch (cause) {
			if (!disposed) error = errorMessage(cause);
		} finally {
			if (!disposed) busy = false;
		}
	}
</script>

<Dialog.Root
	open={true}
	onOpenChange={(value) => {
		if (!value) onClose();
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header
			><Dialog.Title>Find your rhythm</Dialog.Title><Dialog.Description
				>Set a daily intention for this German · {dictionary.nativeLanguage === 'ru'
					? 'Russian'
					: 'English'} dictionary.</Dialog.Description
			></Dialog.Header
		>
		<form onsubmit={save} class="space-y-6" aria-busy={busy}>
			<div class="space-y-6" inert={busy}>
				<div class="rounded-2xl border border-border bg-muted/30 p-5">
					<div class="flex items-center justify-between">
						<p class="text-sm font-semibold" id={`${id}-goal`}>Daily review goal</p>
						<TargetIcon class="size-5 text-link" />
					</div>
					<p class="my-5 text-4xl font-bold tracking-tight">
						{goal}<span class="ml-2 text-sm font-normal text-muted-foreground">reviews a day</span>
					</p>
					<Slider
						type="single"
						bind:value={goal}
						min={5}
						max={200}
						step={5}
						class="h-6"
						thumbLabel="Daily review goal"
						aria-labelledby={`${id}-goal`}
					/>
					<RadioGroup.Root
						class="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-5"
						value={String(goal)}
						onValueChange={(value) => {
							goal = Number(value);
						}}
						aria-label="Suggested daily goals"
					>
						{#each [5, 10, 20, 30, 50] as value (value)}
							<label
								for={`${id}-goal-${value}`}
								class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 text-xs font-semibold transition-[background-color,border-color,box-shadow] has-focus-visible:ring-2 has-focus-visible:ring-ring/35 has-data-[state=checked]:border-primary/35 has-data-[state=checked]:bg-primary/10 has-data-[state=checked]:shadow-sm motion-reduce:transition-none"
								><RadioGroup.Item
									id={`${id}-goal-${value}`}
									value={String(value)}
									class="size-3.5"
								/>{value}</label
							>
						{/each}
					</RadioGroup.Root>
					<p class="mt-4 text-xs leading-5 text-muted-foreground">
						Words and phrases both count. Your goal is an intention; you can keep learning after you
						reach it.
					</p>
				</div>
				<div class="space-y-2">
					<label class="text-sm font-semibold" for={`${id}-zone`}>Time zone</label><Input
						id={`${id}-zone`}
						bind:value={timeZone}
						maxlength={100}
						required
						placeholder="e.g. Europe/Berlin"
					/>
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs text-muted-foreground">
							Daily goals and streaks reset at local midnight.
						</p>
						<Button
							variant="ghost"
							size="xs"
							onclick={() => {
								timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
							}}>Use my time zone</Button
						>
					</div>
				</div>
			</div>
			{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			<Dialog.Footer
				><Button variant="outline" onclick={onClose}>Cancel</Button><Button
					type="submit"
					disabled={busy}
					>{#if busy}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{/if}Save
					preferences</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
