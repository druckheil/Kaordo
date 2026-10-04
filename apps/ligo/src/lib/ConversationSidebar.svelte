<script lang="ts">
	// Shows saved messages and lets the user find or select conversations

	import type { LigoConversation } from "@kaordo/contracts";
	import {
		BookmarkIcon,
		Button,
		Input,
		MessageCircleIcon,
		PlusIcon,
		SearchIcon,
	} from "@kaordo/ui";
	import {
		conversationTitle,
		filterConversations,
		formatConversationTime,
		userInitials,
	} from "./ligo-model";

	let {
		conversations,
		selfConversation,
		currentUserId,
		selectedId,
		loading,
		loadError,
		loadingMore,
		hasMore,
		savedBusy,
		savedError,
		filter = $bindable(""),
		onNewConversation,
		onOpenSaved,
		onSelect,
		onRetry,
		onLoadMore,
	}: {
		conversations: LigoConversation[];
		selfConversation: LigoConversation | undefined;
		currentUserId: string;
		selectedId: string | null;
		loading: boolean;
		loadError: boolean;
		loadingMore: boolean;
		hasMore: boolean;
		savedBusy: boolean;
		savedError: string;
		filter?: string;
		onNewConversation: () => void;
		onOpenSaved: () => void;
		onSelect: (id: string) => void;
		onRetry: () => void;
		onLoadMore: () => void;
	} = $props();

	const visibleConversations = $derived(
		filterConversations(conversations, filter, currentUserId),
	);
	const showSavedMessages = $derived(
		!filter || "saved messages".includes(filter.toLocaleLowerCase()),
	);
</script>

<aside
	class={`flex w-full shrink-0 flex-col border-r border-border/75 bg-card/75 md:w-[20rem] lg:w-[21rem] ${selectedId ? "hidden md:flex" : ""}`}
	aria-label="Conversations"
>
	<div class="border-b border-border/70 px-4 pb-4 pt-4">
		<div class="mb-3 flex items-center justify-between">
			<div>
				<p class="text-xs font-semibold uppercase tracking-[0.15em] text-link">Messages</p>
				<h1 class="mt-0.5 text-xl font-bold tracking-tight">Chats</h1>
			</div>
			<Button
				size="icon-sm"
				aria-label="New conversation"
				class="rounded-xl shadow-sm"
				onclick={onNewConversation}
			>
				<PlusIcon class="size-4.5" />
			</Button>
		</div>
		<label class="relative block">
			<SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				aria-label="Filter conversations"
				placeholder="Find a chat"
				class="h-10 rounded-xl border-border/80 bg-background pl-10"
				bind:value={filter}
			/>
		</label>
	</div>

	<div class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
		{#if showSavedMessages}
			<button
				type="button"
				disabled={savedBusy}
				onclick={onOpenSaved}
				aria-current={selfConversation?.id === selectedId ? "page" : undefined}
				class="mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow] hover:bg-muted focus-visible:outline-3 focus-visible:outline-ring"
				class:shadow-sm={selfConversation?.id === selectedId}
				class:bg-muted={selfConversation?.id === selectedId}
			>
				<span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
					<BookmarkIcon class="size-5" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm font-semibold">Saved messages</span>
					<span class="block truncate text-xs text-muted-foreground">
						{selfConversation?.lastMessage?.deleted
							? "Message deleted"
							: selfConversation?.lastMessage?.text || "Notes and files just for you"}
					</span>
				</span>
			</button>
		{/if}

		{#if savedError}
			<p class="px-3 py-2 text-xs text-destructive" role="alert">{savedError}</p>
		{/if}

		{#if loading}
			<div class="space-y-2 p-2" role="status" aria-label="Loading conversations">
				{#each [1, 2, 3] as placeholder (placeholder)}
					<div class="h-17 animate-pulse rounded-xl bg-muted" aria-hidden="true"></div>
				{/each}
			</div>
		{:else if loadError}
			<div class="p-4 text-sm text-destructive" role="alert">
				Could not load conversations.
				<Button variant="outline" size="sm" class="mt-3" onclick={onRetry}>Retry</Button>
			</div>
		{:else if visibleConversations.length === 0 && (filter || !selfConversation)}
			<div class="px-5 py-12 text-center text-sm text-muted-foreground">
				<div class="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-accent">
					<MessageCircleIcon class="size-6 text-accent-foreground" />
				</div>
				<p class="font-semibold text-foreground">
					{filter ? "No chats match your search" : "Start a conversation"}
				</p>
				<p class="mt-1">
					{filter ? "Try another name." : "Find someone by username, or keep a note for yourself."}
				</p>
				{#if !filter}
					<Button variant="outline" size="sm" class="mt-4" onclick={onNewConversation}>New chat</Button>
				{/if}
			</div>
		{:else}
			{#each visibleConversations as conversation (conversation.id)}
				{@const title = conversationTitle(conversation, currentUserId)}
				<button
					type="button"
					onclick={() => onSelect(conversation.id)}
					aria-current={selectedId === conversation.id ? "page" : undefined}
					class="mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow] hover:bg-muted focus-visible:outline-3 focus-visible:outline-ring"
					class:shadow-sm={selectedId === conversation.id}
					class:bg-muted={selectedId === conversation.id}
				>
					<span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-sm font-bold text-primary-soft-foreground">
						{conversation.kind === "group" ? "◌" : userInitials(title)}
					</span>
					<span class="min-w-0 flex-1">
						<span class="flex items-center justify-between gap-2">
							<span class="truncate text-sm font-semibold">{title}</span>
							{#if conversation.lastMessage}
								<time
									class="shrink-0 text-xs text-muted-foreground"
									datetime={conversation.lastMessage.createdAt}
								>
									{formatConversationTime(conversation.lastMessage.createdAt)}
								</time>
							{/if}
						</span>
						<span class="mt-1 flex items-center justify-between gap-2">
							<span class="truncate text-xs text-muted-foreground">
								{conversation.lastMessage?.deleted
									? "Message deleted"
									: conversation.lastMessage?.text ||
										(conversation.lastMessage
											? "Attachment"
											: conversation.kind === "group"
												? "Group is ready"
												: "Say hello")}
							</span>
							{#if conversation.unreadCount > 0}
								<span
									class="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground"
									aria-label={`${conversation.unreadCount} unread messages`}
								>
									{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
								</span>
							{/if}
						</span>
					</span>
				</button>
			{/each}

			{#if hasMore}
				<div class="py-3 text-center">
					<Button variant="ghost" size="sm" disabled={loadingMore} onclick={onLoadMore}>
						{loadingMore ? "Loading…" : "More conversations"}
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</aside>
