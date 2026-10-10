<script lang="ts">
	// Opens the shared settings page from the rightmost header control and surfaces waiting actions
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { appPaths } from '@kaordo/links';
	import { Button } from './components/ui/button/index.js';
	import type { SettingsNotice } from './settings-notice.js';

	let { current = false, notice }: { current?: boolean; notice?: SettingsNotice } = $props();
</script>

<Button
	href={notice?.href ?? appPaths.agordoj}
	rel="external"
	variant="ghost"
	size="icon"
	class="relative shrink-0"
	aria-label={notice ? `Agordoj, ${notice.label}` : 'Agordoj'}
	aria-current={current ? 'page' : undefined}
	title={notice ? `Agordoj · ${notice.label}` : 'Agordoj · Settings'}
>
	<SettingsIcon class="size-5" />
	{#if notice}<span
			class="absolute -top-1 -right-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground"
			aria-hidden="true">{notice.count}</span
		>{/if}
</Button>
