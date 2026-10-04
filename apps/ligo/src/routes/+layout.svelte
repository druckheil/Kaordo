<script lang="ts">
	// Loads shared design tokens for every Ligo route

	import './layout.css';
  import { ThemeProvider } from '@kaordo/ui';

  let { children } = $props();
</script>

<ThemeProvider />
{@render children()}
