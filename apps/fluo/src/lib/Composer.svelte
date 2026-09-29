<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import type { FluoDocument, FluoPost } from '@kaordo/contracts';
  import type { FluoApi } from '@kaordo/api-client';
  import { uploadMedia } from '@kaordo/media-client';
  import { BoldIcon, Button, ImagePlusIcon, ItalicIcon, StrikethroughIcon } from '@kaordo/ui';

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
  let files = $state.raw<File[]>([]);
  let pending = $state(false);
  let progress = $state(0);
  let error = $state('');

  onMount(() => {
    const instance = new Editor({
      element,
      extensions: [StarterKit.configure({
        blockquote: false, bulletList: false, code: false, codeBlock: false,
        heading: false, horizontalRule: false, link: false, orderedList: false,
        listItem: false, listKeymap: false, underline: false
      })],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      editorProps: { attributes: { 'aria-label': 'Post text', class: 'min-h-28 outline-none' } },
      onUpdate: ({ editor: current }) => { textLength = current.getText().trim().length; }
    });
    editor = instance;
    return () => instance.destroy();
  });

  function chooseFiles() {
    const selected = [...(fileInput?.files ?? [])];
    if (selected.length + files.length > 4) {
      error = 'Add at most four files.';
      return;
    }
    files = [...files, ...selected];
    error = '';
    if (fileInput) fileInput.value = '';
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
      const attachmentIds = await uploadMedia(files, import.meta.env.VITE_KAORDO_NODO_URL, api, (value) => { progress = value; });
      await api.create({
        content: editor.getJSON() as FluoDocument,
        visibility,
        ...(replyTo ? { parentId: replyTo.id } : {}),
        ...(quoteTo ? { quoteId: quoteTo.id } : {}),
        attachmentIds
      });
      editor.commands.clearContent();
      textLength = 0;
      files = [];
      visibility = 'public';
      onPublished();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not publish your post.';
    } finally {
      pending = false;
    }
  }
</script>

<div class="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
  {#if replyTo || quoteTo}
    <div class="mb-4 flex items-start justify-between gap-3 rounded-xl bg-muted p-3 text-sm">
      <p class="min-w-0 truncate"><span class="font-medium">{replyTo ? 'Replying to' : 'Quoting'} @{(replyTo ?? quoteTo)?.author.username}</span><span class="ml-2 text-muted-foreground">{(replyTo ?? quoteTo)?.text}</span></p>
      <Button variant="ghost" size="xs" disabled={pending} onclick={onCancel}>Cancel</Button>
    </div>
  {/if}
  <div class="mb-3 flex gap-1 border-b pb-2" aria-label="Text formatting">
    <Button variant="ghost" size="icon-sm" aria-label="Bold" aria-pressed={editor?.isActive('bold') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleBold().run()}><BoldIcon class="size-4" /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Italic" aria-pressed={editor?.isActive('italic') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleItalic().run()}><ItalicIcon class="size-4" /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Strike through" aria-pressed={editor?.isActive('strike') ?? false} disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleStrike().run()}><StrikethroughIcon class="size-4" /></Button>
  </div>
  <div bind:this={element} class="min-h-28 text-sm leading-6" aria-label="Post text editor"></div>
  {#if files.length > 0}
    <ul class="mt-3 space-y-1 text-sm text-muted-foreground" aria-label="Attachments">
      {#each files as file, index}
        <li class="flex items-center justify-between gap-3"><span class="truncate">{file.name}</span><Button size="xs" variant="ghost" disabled={pending} onclick={() => files = files.filter((_, position) => position !== index)}>Remove</Button></li>
      {/each}
    </ul>
  {/if}
  {#if pending && files.length > 0}
    <p class="mt-3 text-xs text-muted-foreground" role="status">{progress < 100 ? `Uploading media: ${progress}%` : 'Processing media…'}</p>
  {/if}
  {#if error}<p class="mt-3 text-sm text-destructive" role="alert">{error}</p>{/if}
  <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
    <div class="flex items-center gap-3">
      <input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mov" multiple class="sr-only" aria-label="Choose photos or videos" onchange={chooseFiles} />
      <Button size="sm" variant="outline" disabled={pending} onclick={() => fileInput?.click()}><ImagePlusIcon class="size-4" /> Media</Button>
      <select aria-label="Post visibility" bind:value={visibility} disabled={pending || !!replyTo}
        class="h-8 rounded-xl border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
        <option value="public">Public</option>
        <option value="private">Only me</option>
      </select>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs text-muted-foreground" aria-label="Character count">{textLength}/{replyTo ? 2000 : 5000}</span>
      <Button disabled={!editor || pending} onclick={publish}>{pending ? 'Publishing…' : replyTo ? 'Reply' : 'Publish'}</Button>
    </div>
  </div>
</div>

<style>
  :global(.tiptap p + p) { margin-top: 0.6rem; }
  :global(.tiptap:focus) { outline: none; }
</style>
