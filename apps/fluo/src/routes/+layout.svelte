<script lang="ts">
	// Loads shared design tokens for every Fluo route

	import './layout.css';
	import { ThemeProvider } from '@kaordo/ui';

	let { children } = $props();
</script>

<ThemeProvider />
{@render children()}
