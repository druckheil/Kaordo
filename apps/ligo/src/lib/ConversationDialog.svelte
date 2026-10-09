<script lang="ts">
	// Presents conversation discovery and group forms through the owned dialog controller

	import { onDestroy, untrack } from 'svelte';
	import type { QueryClient } from '@tanstack/svelte-query';
	import type { LigoConversation } from '@kaordo/contracts';
	import { UserAvatar } from '@kaordo/account-ui';
	import { BookmarkIcon, Button, CheckIcon, Dialog, Input, SearchIcon } from '@kaordo/ui';
	import type { ConversationDialogMode } from './ligo-model';
	import {
		createConversationDialogState,
		type ConversationDialogApi
	} from './conversation-dialog-state.svelte.ts';

	let {
		api,
		queryClient,
		selectedId,
		selected,
		selfBusy,
		savedError,
		open = $bindable(null),
		onOpenSaved,
		onSelectConversation
	}: {
		api: ConversationDialogApi;
		queryClient: QueryClient;
		selectedId: string | null;
		selected: LigoConversation | null;
		selfBusy: boolean;
		savedError: string;
		open?: ConversationDialogMode | null;
		onOpenSaved: () => void;
		onSelectConversation: (id: string) => void;
	} = $props();

	const state = createConversationDialogState({
		api: untrack(() => api),
		queryClient: untrack(() => queryClient),
		mode: () => open,
		selected: () => selected,
		selectedId: () => selectedId,
		onClose: () => {
			open = null;
		},
		onSelect: (id) => onSelectConversation(id)
	});
	const form = state.form;
	const dialogTitle = $derived(
		open === 'add' ? 'Add people' : form.groupMode ? 'New group' : 'New conversation'
	);
	const dialogDescription = $derived(
		open === 'add'
			? 'Find Kaordo accounts by username. New members can read messages sent after they join.'
			: 'Find Kaordo accounts by username. Start a direct chat, create a group, or save a note for yourself.'
	);
	onDestroy(state.dispose);
</script>

<Dialog.Root
	open={open !== null}
	onOpenChange={(isOpen) => {
		if (!isOpen) state.close();
	}}
>
	<Dialog.Content class="max-h-[90dvh] overflow-hidden p-2 sm:max-w-lg">
		<div class="kaordo-scrollbar max-h-[calc(90dvh-1rem)] overflow-y-auto p-3 sm:p-5">
			<Dialog.Header class="mb-5 pr-10">
				<Dialog.Title class="text-xl font-bold">{dialogTitle}</Dialog.Title>
				<Dialog.Description>{dialogDescription}</Dialog.Description>
			</Dialog.Header>

			{#if open === 'new'}
				<button
					type="button"
					disabled={selfBusy}
					onclick={onOpenSaved}
					class="mb-4 flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
				>
					<BookmarkIcon class="size-5 text-link" />
					<span>
						<span class="block text-sm font-semibold">Saved messages</span>
						<span class="block text-xs text-muted-foreground">A private chat with yourself</span>
					</span>
				</button>
				<label class="mb-4 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
					<input
						type="checkbox"
						bind:checked={form.groupMode}
						class="size-5 rounded accent-primary"
					/>
					Create a group
				</label>
			{/if}

			{#if form.groupMode && open === 'new'}
				<label
					class="mb-4 block text-xs font-semibold tracking-wider text-muted-foreground uppercase"
					for="ligo-group-title"
				>
					Group name
				</label>
				<Input
					id="ligo-group-title"
					class="mb-4"
					maxlength={100}
					placeholder="Give your group a name"
					bind:value={form.groupTitle}
				/>
			{/if}

			<label
				class="block text-xs font-semibold tracking-wider text-muted-foreground uppercase"
				for="ligo-user-search"
			>
				Find people
			</label>
			<div class="relative mt-2">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					id="ligo-user-search"
					class="pl-10"
					placeholder="Search by username"
					value={form.searchInput}
					oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
						state.changeSearch(event.currentTarget.value)}
				/>
			</div>

			{#if form.selectedUsers.length}
				<div class="mt-3 flex flex-wrap gap-2">
					{#each form.selectedUsers as candidate (candidate.id)}
						<button
							type="button"
							class="inline-flex min-h-8 items-center rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => state.toggleUser(candidate)}
							aria-label={`Remove ${candidate.username}`}
						>
							@{candidate.username} ×
						</button>
					{/each}
				</div>
			{/if}

			<div class="mt-4 min-h-24">
				{#if state.searchTerm.length < 2}
					<p class="py-5 text-center text-sm text-muted-foreground">
						Type at least two characters to search.
					</p>
				{:else if state.searchQuery.isPending}
					<p class="py-5 text-center text-sm text-muted-foreground" role="status">
						Searching accounts…
					</p>
				{:else if state.searchQuery.error}
					<p class="py-5 text-center text-sm text-destructive" role="alert">
						Search is unavailable. Try again.
					</p>
				{:else if !state.availableUsers.length}
					<p class="py-5 text-center text-sm text-muted-foreground">
						{state.searchQuery.data?.items.length
							? 'Everyone matching is already in this group.'
							: 'No accounts found.'}
					</p>
				{:else}
					{#each state.availableUsers as candidate (candidate.id)}
						<button
							type="button"
							disabled={state.busy}
							onclick={() =>
								form.groupMode
									? state.toggleUser(candidate)
									: void state.startDirectChat(candidate)}
							class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
						>
							<UserAvatar
								user={candidate}
								class="size-9 rounded-xl [&_[data-slot=avatar-fallback]]:text-xs"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-semibold">{candidate.displayName}</span>
								<span class="block truncate text-xs text-muted-foreground"
									>@{candidate.username}</span
								>
							</span>
							{#if form.selectedUsers.some((user) => user.id === candidate.id)}
								<CheckIcon class="size-4 text-link" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			{#if state.error || savedError}
				<p class="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{state.error || savedError}
				</p>
			{/if}

			{#if form.groupMode}
				<Dialog.Footer class="mt-5 flex flex-row justify-end gap-2 border-t border-border pt-4">
					<Button variant="outline" disabled={state.busy} onclick={state.close}>Cancel</Button>
					<Button
						disabled={state.busy ||
							!form.selectedUsers.length ||
							(open === 'new' && !form.groupTitle.trim())}
						onclick={() => void state.confirmGroupChange()}
					>
						{state.busy ? 'Working…' : open === 'add' ? 'Add people' : 'Create group'}
					</Button>
				</Dialog.Footer>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
