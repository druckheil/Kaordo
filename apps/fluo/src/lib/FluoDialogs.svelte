<script lang="ts">
  import type { QueryClient } from '@tanstack/svelte-query';
  import type { FluoApi } from '@kaordo/api-client';
  import type { FluoPost, UserIdentity } from '@kaordo/contracts';
  import { Button, ChevronLeftIcon, Dialog } from '@kaordo/ui';
  import Composer from './Composer.svelte';
  import PostCard from './PostCard.svelte';
  import { maxMediaHeightRem, mediaFrameRatio } from '@kaordo/media-ui';

  let {
    api, user, queryClient, replyTo, quoteTo, composerOpen, postDialogOpen, post, postPending, postError,
    deleteTarget, deleteError, deleting,
    onComposerOpenChange, onRemoveQuote, onPublished, onPostOpenChange, onClosePost,
    onReply, onQuote, onOpenPost, onReact, onFollow, onSave, onDelete,
    onDeleteOpenChange, onConfirmDelete
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
    onReact: (post: FluoPost, value: 'good' | 'bad' | null) => Promise<void>;
    onFollow: (post: FluoPost) => Promise<void>;
    onSave: (post: FluoPost) => Promise<void>;
    onDelete: (post: FluoPost) => void;
    onDeleteOpenChange: (open: boolean) => void;
    onConfirmDelete: () => void;
  } = $props();

  const postDialogWidth = $derived.by(() => {
    const onlyMedia = post?.media.length === 1 ? post.media[0] : null;
    if (!onlyMedia) return 'min(60rem, calc(100vw - 2rem))';
    const frameWidth = maxMediaHeightRem * mediaFrameRatio(onlyMedia);
    return `min(${Math.min(60, Math.max(28, frameWidth + 7))}rem, calc(100vw - 2rem))`;
  });

  // Media dimensions arrive with the post payload. Mounting the dialog only
  // after that payload is ready prevents its width and height from jumping.
  const detailReady = $derived(postDialogOpen && (!!post || !!postError));
  let showPostLoading = $state(false);

  $effect(() => {
    if (!postDialogOpen || detailReady) {
      showPostLoading = false;
      return;
    }
    const timer = setTimeout(() => { showPostLoading = true; }, 180);
    return () => clearTimeout(timer);
  });

  function dismissPendingPost(event: KeyboardEvent) {
    if (event.key === 'Escape' && postDialogOpen && !detailReady) {
      event.preventDefault();
      onClosePost();
    }
  }
</script>

<svelte:window onkeydown={dismissPendingPost} />

<Dialog.Root open={composerOpen} onOpenChange={onComposerOpenChange}>
  <Dialog.Content class="max-h-[90dvh] overflow-hidden p-2 sm:max-w-2xl">
    <div class="kaordo-scrollbar min-w-0 max-h-[calc(90dvh-1rem)] overflow-y-auto p-2 sm:p-4">
      <Dialog.Header class="mb-5 pr-12">
        <Dialog.Title class="text-xl font-bold tracking-tight">{replyTo ? 'Reply to post' : quoteTo ? 'Quote post' : 'Create a post'}</Dialog.Title>
        <Dialog.Description class="sr-only">Write a post and optionally attach media or change post options.</Dialog.Description>
      </Dialog.Header>
      {#if composerOpen}
        <Composer {api} {replyTo} {quoteTo} onPublished={onPublished} onCancel={onRemoveQuote} />
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

{#if showPostLoading}
  <div class="fixed left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full border border-border bg-card py-2 pl-4 pr-2 text-sm font-medium shadow-lg">
    <span class="size-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true"></span>
    <span role="status" aria-live="polite">Opening post…</span>
    <Button variant="ghost" size="xs" onclick={onClosePost}>Cancel</Button>
  </div>
{/if}

<Dialog.Root open={detailReady} onOpenChange={onPostOpenChange}>
  <Dialog.Content class="grid-cols-[minmax(0,1fr)] min-w-0 overflow-hidden p-2" style={`max-width: ${postDialogWidth}`}>
    <div class="post-detail-scroll kaordo-scrollbar grid min-w-0 max-h-[calc(90dvh-1rem)] grid-cols-[minmax(0,1fr)] gap-6 overflow-x-hidden overflow-y-auto p-1 sm:p-3">
      <Dialog.Header class="pr-10">
        <Dialog.Title class="text-lg font-bold">Post</Dialog.Title>
        <Dialog.Description class="sr-only">Read the quoted post, then go back to your place in the feed.</Dialog.Description>
      </Dialog.Header>
      <div class="min-w-0">
        <Button variant="ghost" size="sm" class="mb-3" onclick={onClosePost}>
          <ChevronLeftIcon class="size-4" /> Back
        </Button>
        {#if postPending}
          <p role="status" class="rounded-xl bg-muted p-6 text-sm text-muted-foreground">Loading post…</p>
        {:else if postError}
          <p role="alert" class="rounded-xl bg-muted p-6 text-sm text-destructive">{postError}</p>
        {:else if post}
          <PostCard {post} viewerId={user.id} {api} {queryClient}
            onReply={() => onReply(post!)} onQuote={() => onQuote(post!)} onOpenPost={onOpenPost}
            onReact={(value) => onReact(post!, value)}
            onFollow={() => onFollow(post!)}
            onSave={() => onSave(post!)}
            onDelete={() => onDelete(post!)} />
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!deleteTarget} onOpenChange={onDeleteOpenChange}>
  <Dialog.Content class="z-[70] max-w-[28rem] p-5 sm:p-6" showCloseButton={false}>
    <Dialog.Header>
      <Dialog.Title class="text-lg font-bold tracking-tight">Delete post?</Dialog.Title>
      <Dialog.Description class="leading-6 text-muted-foreground">This also removes its replies and attachments. This action cannot be undone.</Dialog.Description>
    </Dialog.Header>
    {#if deleteError}<p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{deleteError}</p>{/if}
    <Dialog.Footer class="flex flex-row justify-end gap-2">
      <Button variant="outline" disabled={deleting} onclick={() => onDeleteOpenChange(false)}>Cancel</Button>
      <Button variant="destructive" disabled={deleting} onclick={onConfirmDelete}>{deleting ? 'Deleting…' : 'Delete post'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
