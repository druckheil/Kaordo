<script lang="ts">
	// Toggles the shared color mode using the Rhea button and Lucide icons
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { mode, theme, toggleMode } from 'mode-watcher';
	import { Button } from './components/ui/button/index.js';
	import { resolveTheme } from './themes/index.js';

	const dark = $derived(mode.current === 'dark');
</script>

<Button
	variant="ghost"
	size="icon"
	class="relative shrink-0"
	aria-label="Dark mode"
	aria-pressed={dark}
	title={`${resolveTheme(theme.current).name} · Switch to ${dark ? 'light' : 'dark'} mode`}
	onclick={toggleMode}
>
	<MoonIcon class="size-5 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
	<SunIcon
		class="absolute size-5 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0"
	/>
</Button>
