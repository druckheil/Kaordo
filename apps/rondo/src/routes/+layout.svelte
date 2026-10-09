<script lang="ts">
	// Loads the shared design system for Rondo routes

	import './layout.css';

	import { ThemeProvider } from '@kaordo/ui';

	let { children }: { children: import('svelte').Snippet } = $props();
</script>

<ThemeProvider />
{@render children()}
