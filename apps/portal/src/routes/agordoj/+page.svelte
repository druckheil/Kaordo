<script lang="ts">
	// Lists the Agordoj sections, matching the entry pattern of product settings
	import { agordojPaths } from '@kaordo/links';
	import { Button, ChevronRightIcon, KeyRoundIcon, PaletteIcon } from '@kaordo/ui';

	const sections = [
		{
			href: agordojPaths.appearance,
			label: 'Appearance',
			description: 'Theme and light or dark mode for every app.',
			icon: PaletteIcon
		},
		{
			href: agordojPaths.encryption,
			label: 'Encryption & recovery',
			description: 'Approve new devices and keep a recovery key.',
			icon: KeyRoundIcon
		}
	] as const;
</script>

<svelte:head>
	<title>Agordoj | Kaordo</title>
	<meta name="description" content="Appearance and device security for every Kaordo app." />
</svelte:head>

<div class="max-w-2xl">
	<div class="mb-8">
		<h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
		<p class="mt-3 text-sm leading-6 text-muted-foreground">
			Preferences shared by every Kaordo app.
		</p>
	</div>
	<nav class="grid gap-3" aria-label="Agordoj">
		{#each sections as item (item.href)}
			{@const Icon = item.icon}
			<Button
				href={item.href}
				variant="outline"
				class="group/settings-entry h-auto min-h-24 w-full justify-start gap-4 rounded-[1.5rem] bg-card px-5 py-5 text-left whitespace-normal shadow-sm hover:border-primary/35 hover:shadow-md"
			>
				<span
					class="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground"
					><Icon class="size-5" /></span
				>
				<span class="min-w-0 flex-1">
					<span class="block text-base font-semibold">{item.label}</span>
					<span class="mt-1 block text-sm leading-5 font-normal text-muted-foreground"
						>{item.description}</span
					>
				</span>
				<ChevronRightIcon
					class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/settings-entry:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none"
				/>
			</Button>
		{/each}
	</nav>
</div>
