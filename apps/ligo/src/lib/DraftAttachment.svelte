<script lang="ts">
  import { onMount } from 'svelte';
  import { Attachment, FileIcon, PlayIcon, XIcon } from '@kaordo/ui';

  let {
    file, remove, status, progress = 0
  }: {
    file: File;
    remove?: () => void;
    status?: 'uploading' | 'sending' | 'failed';
    progress?: number;
  } = $props();

  let preview = $state<string | null>(null);
  const image = $derived(file.type.startsWith('image/'));
  const video = $derived(file.type.startsWith('video/'));
  const kind = $derived(image ? 'Photo' : video ? 'Video' : 'File');
  const size = $derived(file.size < 1024 * 1024
    ? `${Math.max(1, Math.ceil(file.size / 1024))} KB`
    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`);
  const detail = $derived(status === 'uploading' ? `Uploading ${progress}%` :
    status === 'sending' ? 'Sending…' : status === 'failed' ? 'Not sent' : `${kind} · ${size}`);

  onMount(() => {
    if (!image && !video) return;
    const url = URL.createObjectURL(file);
    preview = url;
    return () => URL.revokeObjectURL(url);
  });
</script>

<Attachment.Root state={status === 'failed' ? 'error' : status === 'uploading' ? 'uploading' : status === 'sending' ? 'processing' : 'idle'}
  size="sm" class="w-full min-w-0 flex-col flex-nowrap gap-0! overflow-hidden rounded-xl border-border/80 bg-card p-0! shadow-xs transition-[border-color,box-shadow] hover:border-primary/35 hover:shadow-sm">
  <div class="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-accent via-muted to-secondary">
    {#if preview && image}
      <img src={preview} alt={`Preview of ${file.name}`} class="h-full w-full object-cover" />
    {:else if preview && video}
      <video src={`${preview}#t=0.001`} muted playsinline preload="metadata"
        aria-label={`Preview of ${file.name}`} class="h-full w-full object-cover"></video>
      <span class="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
        <span class="grid size-9 place-items-center rounded-full bg-background/85 text-foreground shadow-md backdrop-blur-sm"><PlayIcon class="size-4 fill-current" /></span>
      </span>
    {:else}
      <div class="grid h-full w-full place-items-center text-primary/75"><FileIcon class="size-9" /></div>
    {/if}
    {#if remove}
      <Attachment.Action aria-label={`Remove ${file.name}`} onclick={remove}
        class="absolute right-1.5 top-1.5 z-10 size-7 rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-background">
        <XIcon class="size-3.5" />
      </Attachment.Action>
    {/if}
  </div>
  <Attachment.Content class="w-full min-w-0 gap-0.5 p-2!">
    <Attachment.Title class="truncate text-xs font-semibold">{file.name}</Attachment.Title>
    <Attachment.Description class="truncate text-[11px]">{detail}</Attachment.Description>
  </Attachment.Content>
</Attachment.Root>
