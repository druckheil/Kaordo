<script lang="ts">
	// Manages a rich-text post draft and its publishing state

  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import type { FluoPost } from '@kaordo/contracts';
  import type { FluoApi } from '@kaordo/api-client';
  import { Button, EllipsisIcon, ImagePlusIcon, IsUsingKeyboard } from '@kaordo/ui';
  import ComposerAttachmentList from './ComposerAttachmentList.svelte';
  import ComposerOptionsPanel from './ComposerOptionsPanel.svelte';
  import { composerMediaTypes, maxComposerAttachments, type ComposerAttachment } from './composer-model';
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
  let draftViewport: HTMLDivElement;
  let viewportHeight = 0;
  let fileInput: HTMLInputElement;
  let optionsButton = $state<HTMLElement | null>(null);
  let editor = $state.raw<Editor | null>(null);
  let textLength = $state(0);
  let visibility = $state<'public' | 'private'>('public');
  let files = $state.raw<ComposerAttachment[]>([]);
  let pending = $state(false);
  let progress = $state(0);
  let error = $state('');
  let optionsOpen = $state(false);
  const keyboard = new IsUsingKeyboard();
  const characterLimit = $derived(replyTo ? 2_000 : 5_000);
  const publishLabel = $derived.by(() => {
    if (replyTo) return 'Reply';
    if (quoteTo) return textLength === 0 ? 'Repost' : 'Quote';
    return 'Post';
  });

  $effect(() => { if (replyTo) visibility = replyTo.visibility; });
  $effect(() => { editor?.setEditable(!pending); });

  onMount(() => {
    let active = true;
    let instance: Editor | undefined;
    void createComposerEditor(element, replyTo, (length) => (textLength = length), addFiles)
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
    addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  function addFiles(selectedFiles: File[]): void {
    if (pending || selectedFiles.length === 0) return;
    if (selectedFiles.length + files.length > maxComposerAttachments) {
      error = `Add at most ${maxComposerAttachments} files.`;
      return;
    }

    files = [
      ...files,
      ...selectedFiles.map((file) => ({ file, preview: URL.createObjectURL(file), altText: '' })),
    ];
    error = '';
  }

  function setOptionsOpen(open: boolean): void {
    if (optionsOpen === open) return;
    optionsOpen = open;
    if (!open) optionsButton?.focus({ preventScroll: true });
  }

  function resizeDraftViewport(height: number): void {
    const previousHeight = viewportHeight;
    viewportHeight = height;
    // Preserve the last visible line when options reduce the available viewport
    if (previousHeight && draftViewport?.isConnected && draftViewport.scrollHeight > height) {
      draftViewport.scrollTop += previousHeight - height;
    }
  }

  async function publish(): Promise<void> {
    if (!editor || pending) return;
    if (textLength > characterLimit) {
      error = `Text must be ${characterLimit} characters or fewer.`;
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

<div class="flex min-h-0 min-w-0 flex-[1_1_auto] flex-col gap-3">
  <div class="draft-viewport kaordo-scrollbar min-h-0 min-w-0 flex-[1_1_auto] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--control-border)] bg-background p-4 pb-7 [scrollbar-gutter:stable]"
    class:keyboard-focus={keyboard.current}
    bind:this={draftViewport} bind:clientHeight={null, resizeDraftViewport} role="presentation"
    onclick={(event) => { if (event.target === event.currentTarget) editor?.commands.focus('end'); }}>
    <div class="flow-root min-w-0">
      {#if replyTo}
        <section class="mb-5" aria-label="Post being replied to">
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Replying to</p>
          <QuotePreview quote={replyTo} context="reply" />
        </section>
      {/if}
      {#if !editor && !error}<p class="text-sm text-muted-foreground" role="status">Loading editor…</p>{/if}
      <div class="editor-surface min-w-0 wrap-anywhere text-[15px] leading-7" bind:this={element}></div>
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
    </div>
  </div>
  {#if optionsOpen}
    <ComposerOptionsPanel
      {editor}
      bind:visibility
      {pending}
      replying={!!replyTo}
      onClose={() => setOptionsOpen(false)}
    />
  {/if}
  <div class="flex shrink-0 flex-col gap-3">
    {#if pending && files.length > 0}
      <p class="shrink-0 text-xs text-muted-foreground" role="status">{progress < 100 ? `Uploading media: ${progress}%` : 'Processing media…'}</p>
    {/if}
    {#if error}<p class="shrink-0 text-sm text-destructive" role="alert">{error}</p>{/if}
    <div class="flex shrink-0 items-center justify-between gap-1.5 border-t border-border/80 pt-3 sm:gap-3">
      <div class="flex shrink-0 items-center gap-1 sm:gap-2">
        <input bind:this={fileInput} type="file" accept={[...composerMediaTypes, '.mov'].join(',')} multiple disabled={pending} tabindex="-1" class="sr-only" aria-label="Choose photos or videos" onchange={chooseFiles} />
        <Button class="size-11 p-0 min-[420px]:w-auto min-[420px]:px-3" size="sm" variant="outline" disabled={pending}
          aria-label="Add media" title="Add media" onclick={() => fileInput?.click()}><ImagePlusIcon class="size-4" /><span class="hidden min-[420px]:inline">Media</span></Button>
        <Button class="size-11 p-0 min-[420px]:w-auto min-[420px]:px-3" size="sm" variant={optionsOpen ? 'secondary' : 'ghost'} aria-label="Post options" title="Post options"
          bind:ref={optionsButton} aria-expanded={optionsOpen} aria-controls="fluo-post-options" disabled={pending}
          onclick={() => setOptionsOpen(!optionsOpen)}><EllipsisIcon class="size-4" /><span class="hidden min-[420px]:inline">Options</span></Button>
      </div>
      <div class="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <span class="text-xs tabular-nums text-muted-foreground" aria-label="Character count">{textLength}/{characterLimit}</span>
        <Button class="h-11" disabled={!editor || pending} onclick={publish}>{pending ? 'Publishing…' : publishLabel}</Button>
      </div>
    </div>
  </div>
</div>

<style>
  .editor-surface :global(.tiptap:focus-visible) { outline: none; }
  .draft-viewport.keyboard-focus:focus-within { outline: 2px solid var(--focus-color); outline-offset: 2px; }
  @media (forced-colors: active) { .draft-viewport.keyboard-focus:focus-within { outline-color: Highlight; } }
  .editor-surface :global(.tiptap) {
    min-width: 0;
    min-height: 4lh;
  }
  .editor-surface :global(.tiptap p + p) { margin-top: 0.6rem; }
  .editor-surface :global(.tiptap p.is-editor-empty:first-child::before) {
    color: var(--muted-foreground);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }
</style>
