<script lang="ts">
	// Owns lazy loading, retries and teardown for the Rondo settings screen

	import { onMount, type ComponentProps } from 'svelte';
	import { Button, ChevronLeftIcon } from '@kaordo/ui';
	import type RondoSettings from './RondoSettings.svelte';

	let props: ComponentProps<typeof RondoSettings> = $props();
	let Settings = $state.raw<typeof RondoSettings | null>(null);
	let loading = $state(false);
	let failed = $state(false);
	let active = false;

	async function load(): Promise<void> {
		if (loading) return;
		loading = true;
		failed = false;
		try {
			const { default: component } = await import('./RondoSettings.svelte');
			if (active) Settings = component;
		} catch {
			if (active) failed = true;
		} finally {
			if (active) loading = false;
		}
	}

	onMount(() => {
		active = true;
		void load();
		return () => {
			active = false;
		};
	});
</script>

<svelte:head><title>Rondo settings | Kaordo</title></svelte:head>

{#if Settings}
	<Settings {...props} />
{:else}
	<main
		id="main-content"
		tabindex="-1"
		class="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-4 p-6"
	>
		<Button variant="ghost" onclick={props.onBack}
			><ChevronLeftIcon class="size-4" /> Back to room</Button
		>
		{#if failed}
			<p role="alert" class="text-sm text-destructive">Could not load Rondo settings.</p>
			<Button variant="outline" onclick={() => void load()}>Retry</Button>
		{:else}<p role="status" class="text-sm text-muted-foreground">Loading settings…</p>{/if}
	</main>
{/if}
