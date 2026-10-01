<script lang="ts">
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import type { FluoDocument, FluoPost } from '@kaordo/contracts';
  import type { FluoApi } from '@kaordo/api-client';
  import { BoldIcon, Button, EllipsisIcon, ImagePlusIcon, ItalicIcon, StrikethroughIcon, XIcon } from '@kaordo/ui';
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
  let files = $state.raw<{ file: File; preview: string; altText: string }[]>([]);
  let pending = $state(false);
  let progress = $state(0);
  let error = $state('');
  let optionsOpen = $state(false);

  $effect(() => { if (replyTo) visibility = replyTo.visibility; });

  onMount(() => {
    let active = true;
    let instance: Editor | undefined;
    void Promise.all([import('@tiptap/core'), import('@tiptap/starter-kit'), import('@tiptap/extension-placeholder')])
      .then(([{ Editor: EditorConstructor }, { default: StarterKit }, { Placeholder }]) => {
        if (!active) return;
        instance = new EditorConstructor({
          element,
          extensions: [
            StarterKit.configure({
              blockquote: false, bulletList: false, code: false, codeBlock: false,
              heading: false, horizontalRule: false, link: false, orderedList: false,
              listItem: false, listKeymap: false, underline: false
            }),
            Placeholder.configure({ placeholder: replyTo ? 'Write a reply…' : 'What would you like to share?' })
          ],
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
          editorProps: { attributes: { 'aria-label': replyTo ? 'Reply text' : 'Post text', class: 'outline-none' } },
          onUpdate: ({ editor: current }) => { textLength = current.getText().trim().length; }
        });
        editor = instance;
        instance.commands.focus('end');
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

  function chooseFiles() {
    const selected = [...(fileInput?.files ?? [])];
    if (selected.length + files.length > 4) {
      error = 'Add at most four files.';
      if (fileInput) fileInput.value = '';
      return;
    }
    files = [...files, ...selected.map((file) => ({ file, preview: URL.createObjectURL(file), altText: '' }))];
    error = '';
    if (fileInput) fileInput.value = '';
  }

  function removeFile(index: number) {
    URL.revokeObjectURL(files[index].preview);
    files = files.filter((_, position) => position !== index);
  }

  function changeAltText(index: number, value: string) {
    files = files.map((item, position) => position === index ? { ...item, altText: value } : item);
  }

  async function publish() {
    if (!editor || pending) return;
    const maximum = replyTo ? 2000 : 5000;
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
      const attachmentIds = files.length
        ? await import('@kaordo/media-client').then(({ uploadMedia }) =>
            uploadMedia(files.map((item) => item.file), import.meta.env.VITE_KAORDO_NODO_URL, api, (value) => { progress = value; }))
        : [];
      await api.create({
        content: editor.getJSON() as FluoDocument,
        visibility: replyTo?.visibility ?? visibility,
        ...(replyTo ? { parentId: replyTo.id } : {}),
        ...(quoteTo ? { quoteId: quoteTo.id } : {}),
        attachmentIds,
        altTexts: Object.fromEntries(attachmentIds.flatMap((id, index) => {
          const description = files[index].altText.trim();
          return description ? [[id, description]] : [];
        }))
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
      error = cause instanceof Error ? cause.message : 'Could not publish your post.';
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
    <ul class="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-4" aria-label="Attachments">
      {#each files as item, index (item.preview)}
        <li class="group relative grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-muted/50 min-[420px]:block">
          <div class="flex h-24 items-center justify-center overflow-hidden bg-foreground min-[420px]:h-28">
            {#if item.file.type.startsWith('image/')}
              <img src={item.preview} alt="" class="h-full w-full object-cover" />
            {:else}
              <video src={item.preview} muted playsinline preload="metadata" class="h-full w-full object-contain" aria-hidden="true"></video>
            {/if}
          </div>
          <span class="block truncate px-2 py-1.5 pr-9 text-xs text-muted-foreground min-[420px]:pr-2">{item.file.name}</span>
          <details class="col-span-2 border-t border-border/70 px-2 py-2 text-xs">
            <summary class="cursor-pointer font-medium text-primary underline-offset-4 hover:underline">{item.altText ? 'Edit description' : 'Add description'}</summary>
            <label class="mt-2 block font-medium" for={'fluo-alt-' + index}>Description for {item.file.name}</label>
            <textarea id={'fluo-alt-' + index} rows="2" maxlength="500" value={item.altText}
              disabled={pending} oninput={(event) => changeAltText(index, event.currentTarget.value)}
              class="mt-1 w-full resize-y rounded-lg border border-input bg-card px-2.5 py-2 text-sm leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              placeholder="Describe the media for people using a screen reader"></textarea>
          </details>
          <Button class="absolute right-1.5 top-1.5 rounded-full bg-card/95 shadow-sm" size="icon-xs" variant="outline"
            aria-label={'Remove ' + item.file.name} disabled={pending} onclick={() => removeFile(index)}><XIcon class="size-3.5" /></Button>
        </li>
      {/each}
    </ul>
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
  <div id="fluo-post-options" hidden={!optionsOpen} class="mt-4 rounded-xl border border-border bg-muted/35 p-3">
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs font-semibold text-muted-foreground">Post options</p>
      <Button variant="ghost" size="icon-xs" aria-label="Close post options" disabled={pending} onclick={() => optionsOpen = false}><XIcon class="size-4" /></Button>
    </div>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-1" aria-label="Text formatting">
        <Button variant="ghost" size="icon-sm" aria-label="Bold" aria-pressed={editor?.isActive('bold') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleBold().run()}><BoldIcon class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Italic" aria-pressed={editor?.isActive('italic') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleItalic().run()}><ItalicIcon class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Strike through" aria-pressed={editor?.isActive('strike') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleStrike().run()}><StrikethroughIcon class="size-4" /></Button>
      </div>
      <select aria-label="Post visibility" bind:value={visibility} disabled={pending || !!replyTo}
        class="h-9 rounded-xl border border-input bg-card px-3 text-xs font-medium focus-visible:outline-3 focus-visible:outline-ring">
        <option value="public">Public</option>
        <option value="private">Only me</option>
      </select>
    </div>
    {#if replyTo}<p class="mt-2 text-xs text-muted-foreground">Replies use the original post's visibility.</p>{/if}
  </div>
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
