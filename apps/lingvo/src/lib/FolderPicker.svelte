<script lang="ts">
	// Presents folder selection through the shared accessible dropdown menu
	import type { LingvoFolder } from '@kaordo/contracts';
	import { Button, ChevronDownIcon, DropdownMenu, FolderIcon } from '@kaordo/ui';

	let {
		folders,
		value = $bindable(''),
		emptyLabel = 'Unfiled',
		includeUnfiled = false,
		onValueChange
	}: {
		folders: LingvoFolder[];
		value?: string;
		emptyLabel?: string;
		includeUnfiled?: boolean;
		onValueChange?(this: void, value: string): void;
	} = $props();
	const label = $derived(
		value === 'none'
			? 'Unfiled'
			: (folders.find((folder) => folder.id === value)?.name ?? emptyLabel)
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="max-w-full" aria-label="Choose folder">
				<FolderIcon class="size-4" /><span class="max-w-44 truncate">{label}</span><ChevronDownIcon
					class="size-3.5"
				/>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="max-h-72 overflow-y-auto" align="start">
		<DropdownMenu.Label>Folder</DropdownMenu.Label>
		<DropdownMenu.RadioGroup bind:value {onValueChange}>
			<DropdownMenu.RadioItem value="">{emptyLabel}</DropdownMenu.RadioItem>
			{#if includeUnfiled}<DropdownMenu.RadioItem value="none">Unfiled</DropdownMenu.RadioItem>{/if}
			{#each folders as folder (folder.id)}<DropdownMenu.RadioItem value={folder.id}
					>{folder.name}</DropdownMenu.RadioItem
				>{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
