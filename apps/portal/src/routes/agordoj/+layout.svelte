<script lang="ts">
	// Frames Agordoj sections with the shared header and a way back to the section list
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { appPaths } from '@kaordo/links';
	import { AppHeader, Button, ChevronLeftIcon } from '@kaordo/ui';

	let { children }: { children: Snippet } = $props();
	const inSection = $derived(page.url.pathname !== appPaths.agordoj);
</script>

<AppHeader name="Agordoj" homeHref={appPaths.portal} settingsActive />

<main id="main-content" tabindex="-1" class="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
	{#if inSection}
		<Button class="mb-4" variant="ghost" size="sm" href={appPaths.agordoj}>
			<ChevronLeftIcon class="size-4" />Settings
		</Button>
	{/if}
	{@render children()}
</main>
