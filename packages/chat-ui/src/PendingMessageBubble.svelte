<script lang="ts">
  // Renders an outgoing message while upload or delivery is still in progress

  import { Button, CircleIcon } from '@kaordo/ui';
  import DraftAttachment from './DraftAttachment.svelte';
  import type { PendingMessage } from './types';

  let {
    message,
    retry
  }: {
    message: PendingMessage;
    retry: (message: PendingMessage) => void;
  } = $props();
</script>

<div class="flex justify-end">
  <article class="min-w-0 max-w-[min(86%,38rem)] rounded-[14px] border border-primary/20 bg-primary/8 p-[2px] shadow-xs sm:max-w-[76%]"
    aria-label="Pending message">
    {#if message.files.length}
      <div class="grid gap-0.5 sm:grid-cols-2">
        {#each message.files as file (file)}
          <DraftAttachment {file} status={message.status} progress={message.progress} />
        {/each}
      </div>
    {/if}
    {#if message.text}
      <p class={`whitespace-pre-wrap break-words px-2.5 text-sm leading-5 ${message.files.length ? 'pt-1' : 'pt-1.5'}`}>{message.text}</p>
    {/if}
    <p class="flex items-center justify-end gap-1 px-2 pb-1.5 pt-0.5 text-[11px] text-muted-foreground" role="status">
      {#if message.status !== 'failed'}
        <CircleIcon class="size-3 stroke-[1.4] text-muted-foreground/55" aria-label="Sending" />
      {/if}
      {#if message.status === 'uploading'}Uploading {message.progress}%
      {:else if message.status === 'sending'}Sending…
      {:else}Could not send{/if}
    </p>
    {#if message.status === 'failed'}
      <p class="px-2 pb-1 text-xs text-destructive">{message.error}</p>
      <Button variant="outline" size="xs" class="mx-2 mb-2" onclick={() => retry(message)}>Retry</Button>
    {/if}
  </article>
</div>
