<script lang="ts">
  // Toggles the shared color mode using the Rhea button and Lucide icons
  import MoonIcon from '@lucide/svelte/icons/moon';
  import SunIcon from '@lucide/svelte/icons/sun';
  import { mode, toggleMode } from 'mode-watcher';
  import { Button } from './components/ui/button/index.js';

  const dark = $derived(mode.current === 'dark');
</script>

<Button
  variant="ghost"
  size="icon"
  class="relative shrink-0"
  aria-label="Dark mode"
  aria-pressed={dark}
  title={`Deep Purple · Switch to ${dark ? 'light' : 'dark'} mode`}
  onclick={toggleMode}
>
  <MoonIcon class="size-5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
  <SunIcon class="absolute size-5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
</Button>
