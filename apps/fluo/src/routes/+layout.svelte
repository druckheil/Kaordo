<script lang="ts">
	// Loads shared design tokens for every Fluo route

	import './layout.css';
	import { ThemeProvider } from '@kaordo/ui';

	let { children }: { children: import('svelte').Snippet } = $props();
</script>

<ThemeProvider />
{@render children()}
