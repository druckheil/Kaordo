<script lang="ts">
	// Configures pre-paint appearance and shared preference persistence for every app
	import { ModeWatcher, setTheme, theme } from 'mode-watcher';
	import { defaultTheme, resolveTheme } from './themes/index.js';
	import preferences from './themes/preferences.json' with { type: 'json' };

	$effect(() => {
		if (theme.current && resolveTheme(theme.current).id !== theme.current) {
			setTheme(defaultTheme.id);
		}
	});
</script>

<ModeWatcher
	defaultMode="system"
	defaultTheme={defaultTheme.id}
	modeStorageKey={preferences.modeStorageKey}
	themeStorageKey={preferences.themeStorageKey}
/>
