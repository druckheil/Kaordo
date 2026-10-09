<script lang="ts">
	// Presents account images and an accessible availability dot through shared avatar primitives

	import { getContext } from 'svelte';
	import type { UserPresentation } from '@kaordo/contracts';
	import { Avatar } from '@kaordo/ui';
	import {
		userPresentationContext,
		type UserPresentationState
	} from './user-presentation-context.ts';

	interface Image {
		url: string;
	}
	let {
		user,
		image,
		showPresence = true,
		class: className = ''
	}: {
		user: {
			id: string;
			displayName: string;
			avatar?: Image | null;
			presence?: UserPresentation['presence'];
		};
		image?: Image | null;
		showPresence?: boolean;
		class?: string;
	} = $props();
	const state = getContext<UserPresentationState | undefined>(userPresentationContext);
	const presentation = $derived(state?.get(user.id));
	const avatar = $derived(
		image !== undefined ? image : presentation ? presentation.avatar : user.avatar
	);
	const presence = $derived(state ? presentation?.presence : user.presence);
	const label = $derived(
		presence === 'online' ? 'Online' : presence === 'busy' ? 'Busy' : 'Offline'
	);

	$effect(() => state?.register(user.id));
</script>

<Avatar.Root
	class={`size-11 rounded-2xl bg-accent text-accent-foreground after:rounded-[inherit] ${className}`}
>
	{#if avatar?.url}<Avatar.Image src={avatar.url} alt="" class="rounded-[inherit]" />{/if}
	<Avatar.Fallback class="rounded-[inherit] bg-accent text-sm font-bold text-accent-foreground"
		>{Array.from(user.displayName.trim())[0]?.toLocaleUpperCase() ?? '?'}</Avatar.Fallback
	>
	{#if showPresence && presence}
		<span
			class={`absolute -right-px -bottom-px z-10 size-[clamp(0.5rem,25%,1rem)] rounded-full border-2 border-card transition-colors ${presence === 'online' ? 'bg-emerald-500' : presence === 'busy' ? 'bg-amber-500' : 'bg-slate-400 dark:bg-slate-500'}`}
			data-presence={presence}
			role="img"
			aria-label={label}
			title={label}
		></span>
	{/if}
</Avatar.Root>
