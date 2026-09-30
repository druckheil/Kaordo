<script lang="ts">
  import type { QueryClient } from '@tanstack/svelte-query';
  import type { FluoApi } from '@kaordo/api-client';
  import type { FluoPost, UserIdentity } from '@kaordo/contracts';
  import { Button, ChevronLeftIcon, Dialog } from '@kaordo/ui';
  import Composer from './Composer.svelte';
  import PostCard from './PostCard.svelte';
  import { maxMediaHeightRem, mediaFrameRatio } from './media-layout';

  let {
    api, user, queryClient, replyTo, quoteTo, composerOpen, postDialogOpen, post, postPending, postError,
    onComposerOpenChange, onRemoveQuote, onPublished, onPostOpenChange, onClosePost,
    onReply, onQuote, onOpenPost, onReact, onFollow, onSave, onDelete
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
  } = $props();

  const postDialogWidth = $derived.by(() => {
    const onlyMedia = post?.media.length === 1 ? post.media[0] : null;
    if (!onlyMedia) return 'min(60rem, calc(100vw - 2rem))';
    const frameWidth = maxMediaHeightRem * mediaFrameRatio(onlyMedia);
    return `min(${Math.min(60, Math.max(28, frameWidth + 7))}rem, calc(100vw - 2rem))`;
  });
</script>

<Dialog.Root open={composerOpen} onOpenChange={onComposerOpenChange}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6">
    <Dialog.Header>
      <Dialog.Title class="text-xl font-bold tracking-tight">{replyTo ? 'Reply to post' : quoteTo ? 'Quote post' : 'Create a post'}</Dialog.Title>
      <Dialog.Description class="sr-only">Write a post and optionally attach media or change post options.</Dialog.Description>
    </Dialog.Header>
    {#if composerOpen}
      <Composer {api} {replyTo} {quoteTo} onPublished={onPublished} onCancel={onRemoveQuote} />
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={postDialogOpen} onOpenChange={onPostOpenChange}>
  <Dialog.Content class="grid-cols-[minmax(0,1fr)] min-w-0 overflow-hidden p-2" style={`max-width: ${postDialogWidth}`}>
    <div class="post-detail-scroll grid min-w-0 max-h-[calc(90dvh-1rem)] grid-cols-[minmax(0,1fr)] gap-6 overflow-x-hidden overflow-y-auto p-1 sm:p-3">
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

<style>
  :global(.post-detail-scroll) {
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
    overscroll-behavior: contain;
  }

  :global(.post-detail-scroll::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.post-detail-scroll::-webkit-scrollbar-thumb) {
    border-radius: 999px;
    background: var(--border);
  }
</style>
