<script lang="ts">
	// Renders desktop and mobile Fluo navigation

	import type { UserIdentity } from "@kaordo/contracts";
	import {
		BellIcon,
		BookmarkIcon,
		Button,
		DropdownMenu,
		EllipsisIcon,
		HouseIcon,
		PlusIcon,
		SearchIcon,
		SettingsIcon,
		UserRoundIcon,
	} from "@kaordo/ui";
	import type { FluoView } from "./fluo-model";
	import { displayInitial } from "./fluo-model";

	let {
		view,
		user,
		dialogsLoading,
		onNavigate,
		onOpenComposer,
	}: {
		view: FluoView;
		user: UserIdentity;
		dialogsLoading: boolean;
		onNavigate: (view: FluoView) => void;
		onOpenComposer: () => void;
	} = $props();

	const navigation = [
		{ id: "feed", label: "Feed", icon: HouseIcon },
		{ id: "search", label: "Search", icon: SearchIcon },
		{ id: "notifications", label: "Notifications", icon: BellIcon },
		{ id: "saved", label: "Saved", icon: BookmarkIcon },
		{ id: "profile", label: "Profile", icon: UserRoundIcon },
		{ id: "settings", label: "Settings", icon: SettingsIcon },
	] as const;

	const mobileNavigation = navigation.filter(({ id }) =>
		id === "feed" || id === "search" || id === "saved" || id === "profile",
	);
</script>

<aside class="hidden flex-col lg:sticky lg:top-20 lg:flex lg:h-[calc(100dvh-6rem)] lg:self-start">
	<p class="mb-5 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Explore Fluo</p>
	<nav class="grid gap-1" aria-label="Fluo navigation">
		{#each navigation as item (item.id)}
			{@const Icon = item.icon}
			<Button
				class="h-11 w-full justify-start gap-3 rounded-xl px-4 text-[14px]"
				variant={view === item.id ? "secondary" : "ghost"}
				aria-current={view === item.id ? "page" : undefined}
				onclick={() => onNavigate(item.id)}
			>
				<Icon class="size-5 shrink-0" /> <span class="truncate">{item.label}</span>
			</Button>
		{/each}
	</nav>

	<Button class="mt-auto h-11 w-full justify-center gap-2 rounded-xl" disabled={dialogsLoading} onclick={onOpenComposer}>
		<PlusIcon class="size-5" /> {dialogsLoading ? "Opening…" : "Post"}
	</Button>

	<div class="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
		<div class="grid size-10 shrink-0 place-items-center rounded-xl bg-accent font-bold text-accent-foreground" aria-hidden="true">
			{displayInitial(user.displayName)}
		</div>
		<div class="min-w-0">
			<p class="truncate text-sm font-semibold">{user.displayName}</p>
			<p class="truncate text-xs text-muted-foreground">@{user.username}</p>
		</div>
	</div>
</aside>

<nav
	class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_35px_-28px_rgba(0,0,0,.45)] backdrop-blur-lg lg:hidden"
	aria-label="Fluo navigation"
>
	<Button
		class="h-14 min-w-0 flex-col gap-0.5 rounded-lg px-0 text-xs font-semibold"
		variant="ghost"
		disabled={dialogsLoading}
		aria-label="Post"
		onclick={onOpenComposer}
	>
		<span class="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"><PlusIcon class="size-4" /></span>
		<span>Post</span>
	</Button>
	{#each mobileNavigation as item (item.id)}
		{@const Icon = item.icon}
		<Button
			class={`h-14 min-w-0 flex-col gap-0.5 rounded-lg px-0 text-xs font-semibold tracking-[-0.02em] ${view === item.id ? "" : "text-muted-foreground"}`}
			variant={view === item.id ? "secondary" : "ghost"}
			aria-label={item.label}
			title={item.label}
			aria-current={view === item.id ? "page" : undefined}
			onclick={() => onNavigate(item.id)}
		>
			<Icon class="size-5" />
			<span class="max-w-full truncate">{item.label}</span>
		</Button>
	{/each}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					aria-label="More Fluo sections"
					variant={view === "notifications" || view === "settings" ? "secondary" : "ghost"}
					class={`h-14 min-w-0 flex-col gap-0.5 rounded-lg px-0 text-xs font-semibold ${view === "notifications" || view === "settings" ? "" : "text-muted-foreground"}`}
				>
					<EllipsisIcon class="size-5" /><span>More</span>
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content side="top" align="end" class="mb-2 min-w-44">
			<DropdownMenu.Label>More in Fluo</DropdownMenu.Label>
			<DropdownMenu.Item onSelect={() => onNavigate("notifications")}>
				<BellIcon class="size-4" />Notifications
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => onNavigate("settings")}>
				<SettingsIcon class="size-4" />Settings
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</nav>
