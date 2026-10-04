<script lang="ts">
  // Configures shared pre-paint color mode and preference persistence for every app
  import { ModeWatcher } from 'mode-watcher';
</script>

<ModeWatcher
  defaultMode="system"
  defaultTheme="deep-purple"
  modeStorageKey="kaordo.color-mode"
  themeStorageKey="kaordo.theme"
/>
