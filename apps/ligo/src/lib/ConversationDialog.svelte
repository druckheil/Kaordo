<script lang="ts">
	// Searches for people and creates direct or group conversations

	import { onDestroy } from "svelte";
	import { createQuery, type QueryClient } from "@tanstack/svelte-query";
	import { ligoUserSearchOptions, type LigoApi } from "@kaordo/api-client";
	import type { LigoConversation, LigoUser } from "@kaordo/contracts";
	import {
		BookmarkIcon,
		Button,
		CheckIcon,
		Dialog,
		Input,
		SearchIcon,
	} from "@kaordo/ui";
	import { findAvailableUsers, userInitials, type ConversationDialogMode } from "./ligo-model";

	let {
		api,
		queryClient,
		selectedId,
		selected,
		selfBusy,
		savedError,
		open = $bindable(null),
		onOpenSaved,
		onSelectConversation,
	}: {
		api: LigoApi;
		queryClient: QueryClient;
		selectedId: string | null;
		selected: LigoConversation | null;
		selfBusy: boolean;
		savedError: string;
		open?: ConversationDialogMode | null;
		onOpenSaved: () => void;
		onSelectConversation: (id: string) => void;
	} = $props();

	let groupMode = $state(false);
	let groupTitle = $state("");
	let selectedUsers = $state<LigoUser[]>([]);
	let searchInput = $state("");
	let searchTerm = $state("");
	let dialogBusy = $state(false);
	let dialogError = $state("");
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const searchQuery = createQuery(
		() => ligoUserSearchOptions(api, searchTerm, open !== null),
		() => queryClient,
	);
	const availableUsers = $derived(
		findAvailableUsers(searchQuery.data?.items ?? [], open ?? "new", selected),
	);
	const dialogTitle = $derived(
		open === "add" ? "Add people" : groupMode ? "New group" : "New conversation",
	);
	const dialogDescription = $derived(
		open === "add"
			? "Find Kaordo accounts by username. New members can read messages sent after they join."
			: "Find Kaordo accounts by username. Start a direct chat, create a group, or save a note for yourself.",
	);

	$effect(() => {
		if (!open) return;
		groupMode = open === "add";
		groupTitle = "";
		selectedUsers = [];
		searchInput = "";
		searchTerm = "";
		dialogError = "";
	});

	onDestroy(() => {
		if (searchTimer) clearTimeout(searchTimer);
	});

	function changeSearch(value: string): void {
		searchInput = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTerm = value.trim();
		}, 220);
	}

	function toggleUser(candidate: LigoUser): void {
		const alreadySelected = selectedUsers.some((user) => user.id === candidate.id);
		selectedUsers = alreadySelected
			? selectedUsers.filter((user) => user.id !== candidate.id)
			: [...selectedUsers, candidate];
	}

	function closeDialog(): void {
		if (!dialogBusy) open = null;
	}

	async function selectCreatedConversation(conversation: LigoConversation): Promise<void> {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["ligo", "conversations"] }),
			queryClient.invalidateQueries({ queryKey: ["ligo", "conversation", conversation.id] }),
		]);
		open = null;
		onSelectConversation(conversation.id);
	}

	async function startDirectChat(candidate: LigoUser): Promise<void> {
		dialogBusy = true;
		dialogError = "";
		try {
			const conversation = await api.createConversation({
				kind: "duo",
				participantIds: [candidate.id],
			});
			await selectCreatedConversation(conversation);
		} catch (cause) {
			dialogError = cause instanceof Error ? cause.message : "Could not start the conversation.";
		} finally {
			dialogBusy = false;
		}
	}

	async function confirmGroupChange(): Promise<void> {
		if (!open || !selectedUsers.length || dialogBusy) return;
		dialogBusy = true;
		dialogError = "";
		try {
			const conversation =
				open === "add" && selectedId
					? await api.addMembers(selectedId, selectedUsers.map((user) => user.id))
					: await api.createConversation({
							kind: "group",
							title: groupTitle.trim(),
							participantIds: selectedUsers.map((user) => user.id),
						});
			await selectCreatedConversation(conversation);
		} catch (cause) {
			dialogError = cause instanceof Error ? cause.message : "Could not update the conversation.";
		} finally {
			dialogBusy = false;
		}
	}
</script>

<Dialog.Root
	open={open !== null}
	onOpenChange={(isOpen) => {
		if (!isOpen) closeDialog();
	}}
>
	<Dialog.Content class="max-h-[90dvh] overflow-hidden p-2 sm:max-w-lg">
		<div class="kaordo-scrollbar max-h-[calc(90dvh-1rem)] overflow-y-auto p-3 sm:p-5">
			<Dialog.Header class="mb-5 pr-10">
				<Dialog.Title class="text-xl font-bold">{dialogTitle}</Dialog.Title>
				<Dialog.Description>{dialogDescription}</Dialog.Description>
			</Dialog.Header>

			{#if open === "new"}
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
				<label class="mb-4 flex items-center gap-2 text-sm font-medium">
					<input type="checkbox" bind:checked={groupMode} class="size-5 rounded accent-primary" />
					Create a group
				</label>
			{/if}

			{#if groupMode && open === "new"}
				<label class="mb-4 block text-xs font-semibold uppercase tracking-wider text-muted-foreground" for="ligo-group-title">
					Group name
				</label>
				<Input
					id="ligo-group-title"
					class="mb-4"
					maxlength={100}
					placeholder="Give your group a name"
					bind:value={groupTitle}
				/>
			{/if}

			<label class="block text-xs font-semibold uppercase tracking-wider text-muted-foreground" for="ligo-user-search">
				Find people
			</label>
			<div class="relative mt-2">
				<SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					id="ligo-user-search"
					class="pl-10"
					placeholder="Search by username"
					value={searchInput}
					oninput={(event) => changeSearch(event.currentTarget.value)}
				/>
			</div>

			{#if selectedUsers.length}
				<div class="mt-3 flex flex-wrap gap-2">
					{#each selectedUsers as candidate (candidate.id)}
						<button
							type="button"
							class="inline-flex min-h-8 items-center rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => toggleUser(candidate)}
							aria-label={`Remove ${candidate.username}`}
						>
							@{candidate.username} ×
						</button>
					{/each}
				</div>
			{/if}

			<div class="mt-4 min-h-24">
				{#if searchTerm.length < 2}
					<p class="py-5 text-center text-sm text-muted-foreground">Type at least two characters to search.</p>
				{:else if searchQuery.isPending}
					<p class="py-5 text-center text-sm text-muted-foreground" role="status">Searching accounts…</p>
				{:else if searchQuery.error}
					<p class="py-5 text-center text-sm text-destructive" role="alert">Search is unavailable. Try again.</p>
				{:else if !availableUsers.length}
					<p class="py-5 text-center text-sm text-muted-foreground">
						{searchQuery.data?.items.length
							? "Everyone matching is already in this group."
							: "No accounts found."}
					</p>
				{:else}
					{#each availableUsers as candidate (candidate.id)}
						<button
							type="button"
							disabled={dialogBusy}
							onclick={() => (groupMode ? toggleUser(candidate) : void startDirectChat(candidate))}
							class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
						>
							<span class="grid size-9 place-items-center rounded-xl bg-primary-soft text-xs font-bold text-primary-soft-foreground">
								{userInitials(candidate.displayName)}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-semibold">{candidate.displayName}</span>
								<span class="block truncate text-xs text-muted-foreground">@{candidate.username}</span>
							</span>
							{#if selectedUsers.some((user) => user.id === candidate.id)}
								<CheckIcon class="size-4 text-link" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			{#if dialogError || savedError}
				<p class="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{dialogError || savedError}
				</p>
			{/if}

			{#if groupMode}
				<Dialog.Footer class="mt-5 flex flex-row justify-end gap-2 border-t border-border pt-4">
					<Button variant="outline" disabled={dialogBusy} onclick={closeDialog}>Cancel</Button>
					<Button
						disabled={dialogBusy || !selectedUsers.length || (open === "new" && !groupTitle.trim())}
						onclick={() => void confirmGroupChange()}
					>
						{dialogBusy ? "Working…" : open === "add" ? "Add people" : "Create group"}
					</Button>
				</Dialog.Footer>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
