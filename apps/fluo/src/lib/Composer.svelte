<script lang="ts">
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import type { FluoDocument, FluoPost } from '@kaordo/contracts';
  import type { FluoApi } from '@kaordo/api-client';
  import { BoldIcon, Button, ImagePlusIcon, ItalicIcon, StrikethroughIcon, XIcon } from '@kaordo/ui';

  let { api, replyTo, quoteTo, onPublished, onCancel, compact = false }: {
    api: FluoApi;
    replyTo: FluoPost | null;
    quoteTo: FluoPost | null;
    onPublished: () => void;
    onCancel: () => void;
    compact?: boolean;
  } = $props();

  let element: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let editor = $state.raw<Editor | null>(null);
  let textLength = $state(0);
  let visibility = $state<'public' | 'private'>('public');
  let files = $state.raw<{ file: File; preview: string }[]>([]);
  let pending = $state(false);
  let progress = $state(0);
  let error = $state('');
  let expanded = $state(false);

  $effect(() => {
    if (compact || quoteTo) expanded = true;
  });

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
            Placeholder.configure({ placeholder: compact ? 'Write a reply…' : 'What would you like to share?' })
          ],
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
          editorProps: { attributes: { 'aria-label': compact ? 'Reply text' : 'Post text', class: 'outline-none' } },
          onFocus: () => { expanded = true; },
          onUpdate: ({ editor: current }) => { textLength = current.getText().trim().length; }
        });
        editor = instance;
      })
      .catch(() => {
        if (active) {
          expanded = true;
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
    expanded = true;
    const selected = [...(fileInput?.files ?? [])];
    if (selected.length + files.length > 4) {
      error = 'Add at most four files.';
      if (fileInput) fileInput.value = '';
      return;
    }
    files = [...files, ...selected.map((file) => ({ file, preview: URL.createObjectURL(file) }))];
    error = '';
    if (fileInput) fileInput.value = '';
  }

  function removeFile(index: number) {
    URL.revokeObjectURL(files[index].preview);
    files = files.filter((_, position) => position !== index);
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
        attachmentIds
      });
      editor.commands.clearContent();
      editor.commands.blur();
      textLength = 0;
      for (const item of files) URL.revokeObjectURL(item.preview);
      files = [];
      visibility = 'public';
      if (!compact) expanded = false;
      onPublished();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not publish your post.';
    } finally {
      pending = false;
    }
  }
</script>

<div class={compact ? 'rounded-xl border border-border bg-card p-3 sm:p-4' : 'rounded-[1.5rem] border border-border bg-card p-4 shadow-[0_10px_32px_-25px_rgba(20,65,39,.5)] sm:p-6'}>
  {#if !compact && (replyTo || quoteTo)}
    <div class="mb-4 flex items-start justify-between gap-3 rounded-xl bg-muted p-3 text-sm">
      <p class="min-w-0 truncate"><span class="font-medium">{replyTo ? 'Replying to' : 'Quoting'} @{(replyTo ?? quoteTo)?.author.username}</span><span class="ml-2 text-muted-foreground">{(replyTo ?? quoteTo)?.text}</span></p>
      <Button variant="ghost" size="xs" disabled={pending} onclick={onCancel}>Cancel</Button>
    </div>
  {/if}
  <div class:expanded class:compact class="editor-surface text-[15px] leading-7" bind:this={element}></div>
  {#if !compact && expanded}
    <div class="mt-3 flex gap-1 border-t border-border/80 pt-3" aria-label="Text formatting">
      <Button variant="ghost" size="icon-sm" aria-label="Bold" aria-pressed={editor?.isActive('bold') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleBold().run()}><BoldIcon class="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Italic" aria-pressed={editor?.isActive('italic') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleItalic().run()}><ItalicIcon class="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Strike through" aria-pressed={editor?.isActive('strike') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleStrike().run()}><StrikethroughIcon class="size-4" /></Button>
      <Button class="ml-auto" variant="ghost" size="icon-sm" aria-label="Collapse editor" disabled={pending}
        onclick={() => { editor?.commands.blur(); expanded = false; }}><XIcon class="size-4" /></Button>
    </div>
  {/if}
  {#if files.length > 0}
    <ul class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Attachments">
      {#each files as item, index (item.preview)}
        <li class="group relative min-w-0 overflow-hidden rounded-xl border border-border bg-muted/50">
          <div class="flex aspect-square items-center justify-center overflow-hidden bg-[#17251e]">
            {#if item.file.type.startsWith('image/')}
              <img src={item.preview} alt="" class="h-full w-full object-cover" />
            {:else}
              <video src={item.preview} muted playsinline preload="metadata" class="h-full w-full object-contain" aria-hidden="true"></video>
            {/if}
          </div>
          <span class="block truncate px-2 py-1.5 text-xs text-muted-foreground">{item.file.name}</span>
          <Button class="absolute right-1.5 top-1.5 rounded-full bg-card/95 shadow-sm" size="icon-xs" variant="outline"
            aria-label={'Remove ' + item.file.name} disabled={pending} onclick={() => removeFile(index)}><XIcon class="size-3.5" /></Button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if pending && files.length > 0}
    <p class="mt-3 text-xs text-muted-foreground" role="status">{progress < 100 ? `Uploading media: ${progress}%` : 'Processing media…'}</p>
  {/if}
  {#if error}<p class="mt-3 text-sm text-destructive" role="alert">{error}</p>{/if}
  <div class={(expanded ? 'mt-4 pt-3' : 'mt-2 pt-2') + ' flex flex-wrap items-center justify-between gap-3 border-t border-border/80'}>
    <div class="flex items-center gap-3">
      <input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mov" multiple class="sr-only" aria-label="Choose photos or videos" onchange={chooseFiles} />
      <Button size="sm" variant={compact ? 'ghost' : 'outline'} disabled={pending} aria-label={compact ? 'Add media to reply' : undefined}
        onclick={() => fileInput?.click()}><ImagePlusIcon class="size-4" />{#if !compact} Media{/if}</Button>
      {#if !compact && expanded}
        <select aria-label="Post visibility" bind:value={visibility} disabled={pending || !!replyTo}
          class="h-9 rounded-xl border border-input bg-card px-3 text-xs font-medium focus-visible:outline-3 focus-visible:outline-ring">
          <option value="public">Public</option>
          <option value="private">Only me</option>
        </select>
      {/if}
    </div>
    {#if expanded}
      <div class="flex items-center gap-3">
        <span class="text-xs tabular-nums text-muted-foreground" aria-label="Character count">{textLength}/{replyTo ? 2000 : 5000}</span>
        <Button disabled={!editor || pending} onclick={publish}>{pending ? 'Publishing…' : replyTo ? 'Reply' : 'Publish'}</Button>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-surface :global(.tiptap) { min-height: 2.5rem; }
  .editor-surface.expanded :global(.tiptap) { min-height: 6rem; }
  .editor-surface.compact :global(.tiptap) { min-height: 4rem; }
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
