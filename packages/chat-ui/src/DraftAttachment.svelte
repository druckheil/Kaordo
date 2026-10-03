<script lang="ts">
  // Previews a local attachment and releases its temporary browser URL

  import { Attachment, FileIcon, PlayIcon, XIcon } from '@kaordo/ui';
  import { formatFileSize } from './message-formatting';

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
  const size = $derived(formatFileSize(file.size));
  const detail = $derived(statusDetail());
  const attachmentState = $derived(getAttachmentState());

  function statusDetail(): string {
    switch (status) {
      case 'uploading': return `Uploading ${progress}%`;
      case 'sending': return 'Sending…';
      case 'failed': return 'Not sent';
      default: return `${kind} · ${size}`;
    }
  }

  function getAttachmentState(): 'error' | 'uploading' | 'processing' | 'idle' {
    switch (status) {
      case 'failed': return 'error';
      case 'uploading': return 'uploading';
      case 'sending': return 'processing';
      default: return 'idle';
    }
  }

  $effect(() => {
    if (!image && !video) {
      preview = null;
      return;
    }

    const url = URL.createObjectURL(file);
    preview = url;
    return () => URL.revokeObjectURL(url);
  });
</script>

<Attachment.Root state={attachmentState}
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
        class="absolute right-1.5 top-1.5 z-10 size-8 rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-background">
        <XIcon class="size-3.5" />
      </Attachment.Action>
    {/if}
  </div>
  <Attachment.Content class="w-full min-w-0 gap-0.5 p-2!">
    <Attachment.Title class="truncate text-xs font-semibold">{file.name}</Attachment.Title>
    <Attachment.Description class="truncate text-[11px]">{detail}</Attachment.Description>
  </Attachment.Content>
</Attachment.Root>
