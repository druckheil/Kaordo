<script lang="ts">
  // Loads the shared design system for Rondo routes

  import './layout.css';

  import { ThemeProvider } from '@kaordo/ui';

  let { children } = $props();
</script>

<ThemeProvider />
{@render children()}
