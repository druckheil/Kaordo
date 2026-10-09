<script lang="ts">
	// Loads the shared design system and theme for Lingvo
	import './layout.css';
	import { ThemeProvider } from '@kaordo/ui';
	let { children } = $props();
</script>

<ThemeProvider />
{@render children()}
