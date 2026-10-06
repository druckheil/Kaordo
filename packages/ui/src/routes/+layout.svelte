<script lang="ts">
  // Loads shared styles and color-mode behavior for the component workspace
  import '$lib/styles.css';
  import ThemeProvider from '$lib/ThemeProvider.svelte';
  let { children } = $props();
</script>

<ThemeProvider />
{@render children()}
