<script lang="ts">
	// Loads the shared design system and theme for Memoro
	import './layout.css';
	import { ThemeProvider } from '@kaordo/ui';
	let { children } = $props();
</script>

<ThemeProvider />
{@render children()}
