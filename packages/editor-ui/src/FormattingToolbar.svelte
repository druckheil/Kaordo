<script lang="ts">
	// Reflects the current selection through the shared formatting toggles
	import type { Editor } from '@tiptap/core';
	import { BoldIcon, ItalicIcon, StrikethroughIcon, ToggleGroup } from '@kaordo/ui';

	let { editor, disabled = false }: { editor: Editor | null; disabled?: boolean } = $props();
	const formats = [
		{ value: 'bold', label: 'Bold', icon: BoldIcon },
		{ value: 'italic', label: 'Italic', icon: ItalicIcon },
		{ value: 'strike', label: 'Strike through', icon: StrikethroughIcon }
	];
	let active = $state.raw<string[]>([]);

	$effect(() => {
		if (!editor) {
			active = [];
			return;
		}
		const current = editor;
		const sync = () => {
			active = formats.filter(({ value }) => current.isActive(value)).map(({ value }) => value);
		};
		sync();
		current.on('transaction', sync);
		return () => {
			current.off('transaction', sync);
		};
	});

	function change(values: string[]) {
		if (!editor || disabled) return;
		const current = editor;
		const changed = formats.find(({ value }) => values.includes(value) !== current.isActive(value));
		if (changed) current.chain().focus().toggleMark(changed.value).run();
	}
</script>

<ToggleGroup.Root
	type="multiple"
	variant="outline"
	size="lg"
	aria-label="Text formatting"
	bind:value={() => active, change}
	disabled={!editor || disabled}
>
	{#each formats as format (format.value)}
		{@const Icon = format.icon}
		<ToggleGroup.Item
			value={format.value}
			aria-label={format.label}
			title={format.label}
			class="size-10 transition-[background-color,color,box-shadow] duration-200 data-[state=on]:bg-primary-soft data-[state=on]:text-primary-soft-foreground motion-reduce:transition-none"
		>
			<Icon class="size-4" />
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
