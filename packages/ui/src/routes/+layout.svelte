<script lang="ts">
	// Loads shared styles and color-mode behavior for the component workspace
	import '$lib/styles.css';
	import ThemeProvider from '$lib/ThemeProvider.svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<ThemeProvider />
{@render children()}
