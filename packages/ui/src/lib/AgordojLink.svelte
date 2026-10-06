<script lang="ts">
  // Opens the shared appearance page from the rightmost header control
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import { appPaths } from '@kaordo/links';
  import { Button } from './components/ui/button/index.js';

  let { current = false }: { current?: boolean } = $props();
</script>

<Button
  href={appPaths.agordoj}
  rel="external"
  variant="ghost"
  size="icon"
  class="shrink-0"
  aria-label="Agordoj"
  aria-current={current ? 'page' : undefined}
  title="Agordoj · Theme settings"
>
  <SettingsIcon class="size-5" />
</Button>
