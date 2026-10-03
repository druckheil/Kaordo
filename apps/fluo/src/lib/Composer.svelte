<script lang="ts">
	// Manages a rich-text post draft and its publishing state

  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import type { FluoPost } from '@kaordo/contracts';
  import type { FluoApi } from '@kaordo/api-client';
  import { Button, EllipsisIcon, ImagePlusIcon } from '@kaordo/ui';
  import ComposerAttachmentList from './ComposerAttachmentList.svelte';
  import ComposerOptionsPanel from './ComposerOptionsPanel.svelte';
  import { maxComposerAttachments, type ComposerAttachment } from './composer-model';
  import { createComposerEditor } from './composer-editor';
  import { publishComposerPost } from './composer-publishing';
  import { errorMessage } from './fluo-model';
  import QuotePreview from './QuotePreview.svelte';

  let { api, replyTo, quoteTo, onPublished, onCancel }: {
    api: FluoApi;
    replyTo: FluoPost | null;
    quoteTo: FluoPost | null;
    onPublished: () => void;
    onCancel: () => void;
  } = $props();

  let element: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let editor = $state.raw<Editor | null>(null);
  let textLength = $state(0);
  let visibility = $state<'public' | 'private'>('public');
  let files = $state.raw<ComposerAttachment[]>([]);
  let pending = $state(false);
  let progress = $state(0);
  let error = $state('');
  let optionsOpen = $state(false);

  $effect(() => { if (replyTo) visibility = replyTo.visibility; });

  onMount(() => {
    let active = true;
    let instance: Editor | undefined;
    void createComposerEditor(element, replyTo, (length) => (textLength = length))
      .then((createdEditor) => {
        if (!active) {
          createdEditor.destroy();
          return;
        }
        instance = createdEditor;
        editor = createdEditor;
        createdEditor.commands.focus('end');
      })
      .catch(() => {
        if (active) {
          error = 'The text editor could not load. Reload the page to try again.';
        }
      });
    return () => {
      active = false;
      instance?.destroy();
      for (const item of files) URL.revokeObjectURL(item.preview);
    };
  });

  function chooseFiles(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const selectedFiles = Array.from(input.files ?? []);
    if (selectedFiles.length + files.length > maxComposerAttachments) {
      error = `Add at most ${maxComposerAttachments} files.`;
      input.value = '';
      return;
    }

    files = [
      ...files,
      ...selectedFiles.map((file) => ({ file, preview: URL.createObjectURL(file), altText: '' })),
    ];
    error = '';
    input.value = '';
  }

  async function publish(): Promise<void> {
    if (!editor || pending) return;
    const maximum = replyTo ? 2_000 : 5_000;
    if (textLength > maximum) {
      error = `Text must be ${maximum} characters or fewer.`;
      return;
    }
    if (textLength === 0 && files.length === 0 && !quoteTo) {
      error = 'Write something or attach media before publishing.';
      return;
    }
    pending = true;
    progress = 0;
    error = '';
    try {
      await publishComposerPost({
        api,
        editor,
        replyTo,
        quoteTo,
        visibility,
        attachments: files,
        onProgress: (value) => (progress = value),
      });
      editor.commands.clearContent();
      editor.commands.blur();
      textLength = 0;
      for (const item of files) URL.revokeObjectURL(item.preview);
      files = [];
      visibility = 'public';
      optionsOpen = false;
      onPublished();
    } catch (cause) {
      error = errorMessage(cause, 'Could not publish your post.');
    } finally {
      pending = false;
    }
  }
</script>

<div class="min-w-0 pb-2">
  {#if replyTo}
    <section class="mb-5" aria-label="Post being replied to">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Replying to</p>
      <QuotePreview quote={replyTo} context="reply" />
    </section>
  {/if}
  <div class="min-h-40 rounded-2xl border border-input bg-background p-4 text-[15px] leading-7 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
    {#if !editor && !error}<p class="text-sm text-muted-foreground" role="status">Loading editor…</p>{/if}
    <div class="editor-surface min-h-24" bind:this={element}></div>
  </div>
  {#if files.length > 0}
    <ComposerAttachmentList bind:files {pending} />
  {/if}
  {#if quoteTo}
    <section class="mt-5" aria-label="Quoted post">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quoting</p>
        <Button variant="ghost" size="xs" disabled={pending} onclick={onCancel}>Remove quote</Button>
      </div>
      <QuotePreview quote={quoteTo} />
    </section>
  {/if}
  <ComposerOptionsPanel
    {editor}
    bind:visibility
    {pending}
    replying={!!replyTo}
    open={optionsOpen}
    onClose={() => (optionsOpen = false)}
  />
  {#if pending && files.length > 0}
    <p class="mt-3 text-xs text-muted-foreground" role="status">{progress < 100 ? `Uploading media: ${progress}%` : 'Processing media…'}</p>
  {/if}
  {#if error}<p class="mt-3 text-sm text-destructive" role="alert">{error}</p>{/if}
  <div class="sticky bottom-0 z-10 -mx-2 mt-4 flex items-center justify-between gap-1.5 rounded-xl border-t border-border/80 bg-card/95 px-2 py-3 shadow-[0_-10px_24px_-22px_rgba(20,65,39,.65)] backdrop-blur-sm sm:gap-3">
    <div class="flex shrink-0 items-center gap-1 sm:gap-2">
      <input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mov" multiple class="sr-only" aria-label="Choose photos or videos" onchange={chooseFiles} />
      <Button class="size-11 p-0 min-[420px]:w-auto min-[420px]:px-3" size="sm" variant="outline" disabled={pending}
        aria-label="Add media" title="Add media" onclick={() => fileInput?.click()}><ImagePlusIcon class="size-4" /><span class="hidden min-[420px]:inline">Media</span></Button>
      <Button class="size-11 p-0 min-[420px]:w-auto min-[420px]:px-3" size="sm" variant={optionsOpen ? 'secondary' : 'ghost'} aria-label="Post options" title="Post options"
        aria-expanded={optionsOpen} aria-controls="fluo-post-options" disabled={pending}
        onclick={() => optionsOpen = !optionsOpen}><EllipsisIcon class="size-4" /><span class="hidden min-[420px]:inline">Options</span></Button>
    </div>
    <div class="flex shrink-0 items-center gap-1.5 sm:gap-3">
      <span class="text-xs tabular-nums text-muted-foreground" aria-label="Character count">{textLength}/{replyTo ? 2000 : 5000}</span>
      <Button class="h-11" disabled={!editor || pending} onclick={publish}>{pending ? 'Publishing…' : replyTo ? 'Reply' : 'Publish'}</Button>
    </div>
  </div>
</div>

<style>
  .editor-surface :global(.tiptap) { min-height: 6rem; }
  :global(.tiptap p + p) { margin-top: 0.6rem; }
  :global(.tiptap:focus) { outline: none; }
  :global(.tiptap p.is-editor-empty:first-child::before) {
    color: var(--muted-foreground);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }
</style>
