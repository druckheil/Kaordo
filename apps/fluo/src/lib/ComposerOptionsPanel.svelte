<script lang="ts">
	// Controls native formatting toggles and the post audience menu

	import type { Editor } from "@tiptap/core";
	import { FormattingToolbar } from "@kaordo/editor-ui";
	import {
		Button, ChevronDownIcon, DropdownMenu, GlobeIcon,
		LockIcon, XIcon,
	} from "@kaordo/ui";

	let {
		editor,
		visibility = $bindable("public"),
		pending,
		replying,
		onClose,
	}: {
		editor: Editor | null;
		visibility?: "public" | "private";
		pending: boolean;
		replying: boolean;
		onClose: () => void;
	} = $props();

	const audiences = {
		public: { label: "Public", description: "Share with your audience", icon: GlobeIcon },
		private: { label: "Only me", description: "Visible only to you", icon: LockIcon },
	} as const;
	const audienceChoices = Object.entries(audiences);
	const audience = $derived(audiences[visibility]);
	function changeVisibility(value: string): void {
		if (!pending && !replying && (value === "public" || value === "private")) visibility = value;
	}
</script>

<div id="fluo-post-options" class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-border bg-muted/35 p-2 min-[420px]:grid-cols-[auto_minmax(0,1fr)_auto]">
	<FormattingToolbar {editor} disabled={pending} />
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				{@const Icon = audience.icon}
				<Button {...props} variant="outline" size="sm"
					class="col-span-2 col-start-1 row-start-2 h-10 gap-2 bg-background min-[420px]:col-span-1 min-[420px]:col-start-2 min-[420px]:row-start-1 min-[420px]:justify-self-end"
					aria-label="Post visibility" disabled={pending || replying}>
					<Icon class="size-4 text-muted-foreground" />
					{audience.label}
					<ChevronDownIcon class="size-3.5 text-muted-foreground transition-transform duration-200 group-aria-expanded/button:rotate-180 motion-reduce:transition-none" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" sideOffset={6} class="w-60">
			<DropdownMenu.RadioGroup bind:value={() => visibility, changeVisibility} aria-label="Post visibility">
				{#each audienceChoices as [value, choice] (value)}
					{@const Icon = choice.icon}
					<DropdownMenu.RadioItem {value} closeOnSelect disabled={pending || replying}
						aria-label={choice.label} class="min-h-14 gap-3 px-3 pr-8">
						<Icon class="size-4 text-muted-foreground" />
						<span class="flex flex-col gap-0.5">
							<span class="font-medium">{choice.label}</span>
							<span class="text-xs text-muted-foreground">{choice.description}</span>
						</span>
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
	<Button variant="ghost" size="icon-xs" class="col-start-2 row-start-1 min-[420px]:col-start-3"
		aria-label="Close post options" disabled={pending} onclick={onClose}>
		<XIcon class="size-4" />
	</Button>
	{#if replying}
		<p class="col-span-full text-xs text-muted-foreground">Replies use the original post&apos;s visibility.</p>
	{/if}
</div>
