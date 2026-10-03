<script lang="ts">
	// Connects composer, post detail, and delete confirmation dialogs

	import type { QueryClient } from "@tanstack/svelte-query";
	import type { FluoApi } from "@kaordo/api-client";
	import type { FluoPost, UserIdentity } from "@kaordo/contracts";
	import ComposerDialog from "./ComposerDialog.svelte";
	import DeletePostDialog from "./DeletePostDialog.svelte";
	import PostDetailDialog from "./PostDetailDialog.svelte";

	let {
		api,
		user,
		queryClient,
		replyTo,
		quoteTo,
		composerOpen,
		postDialogOpen,
		post,
		postPending,
		postError,
		deleteTarget,
		deleteError,
		deleting,
		onComposerOpenChange,
		onRemoveQuote,
		onPublished,
		onPostOpenChange,
		onClosePost,
		onReply,
		onQuote,
		onOpenPost,
		onReact,
		onFollow,
		onSave,
		onDelete,
		onDeleteOpenChange,
		onConfirmDelete,
	}: {
		api: FluoApi;
		user: UserIdentity;
		queryClient: QueryClient;
		replyTo: FluoPost | null;
		quoteTo: FluoPost | null;
		composerOpen: boolean;
		postDialogOpen: boolean;
		post: FluoPost | undefined;
		postPending: boolean;
		postError: string | null;
		deleteTarget: FluoPost | null;
		deleteError: string;
		deleting: boolean;
		onComposerOpenChange: (open: boolean) => void;
		onRemoveQuote: () => void;
		onPublished: () => void;
		onPostOpenChange: (open: boolean) => void;
		onClosePost: () => void;
		onReply: (post: FluoPost) => void;
		onQuote: (post: FluoPost) => void;
		onOpenPost: (id: string) => void;
		onReact: (post: FluoPost, value: "good" | "bad" | null) => Promise<void>;
		onFollow: (post: FluoPost) => Promise<void>;
		onSave: (post: FluoPost) => Promise<void>;
		onDelete: (post: FluoPost) => void;
		onDeleteOpenChange: (open: boolean) => void;
		onConfirmDelete: () => void;
	} = $props();
</script>

<ComposerDialog
	{api}
	{replyTo}
	{quoteTo}
	open={composerOpen}
	onOpenChange={onComposerOpenChange}
	onRemoveQuote={onRemoveQuote}
	onPublished={onPublished}
/>

<PostDetailDialog
	{api}
	{user}
	{queryClient}
	open={postDialogOpen}
	{post}
	pending={postPending}
	error={postError}
	onOpenChange={onPostOpenChange}
	onClose={onClosePost}
	{onReply}
	{onQuote}
	{onOpenPost}
	{onReact}
	{onFollow}
	{onSave}
	{onDelete}
/>

<DeletePostDialog
	post={deleteTarget}
	error={deleteError}
	{deleting}
	onOpenChange={onDeleteOpenChange}
	onConfirm={onConfirmDelete}
/>
