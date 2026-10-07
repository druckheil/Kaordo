<script lang="ts">
  // Copies a complete card prompt and applies validated external AI replies to the editor
  import { onDestroy } from 'svelte';
  import type { LingvoCardContent, LingvoDictionary, LingvoFolder } from '@kaordo/contracts';
  import { aiInputLimit, cardPrompt, parseAIInput } from '@kaordo/lingvo-client/ai-input';
  import { Button, CheckIcon, CopyIcon, SparklesIcon, Textarea } from '@kaordo/ui';
  import { errorMessage } from './lingvo-context';

  let { card, nativeLanguage, folders, saveLabel, onApply }:
    { card: LingvoCardContent; nativeLanguage: LingvoDictionary['nativeLanguage']; folders: LingvoFolder[];
      saveLabel: string; onApply(card: LingvoCardContent): void } = $props();
  const id = $props.id();
  const prompt = $derived(cardPrompt(card, nativeLanguage, folders));
  let input = $state('');
  let error = $state('');
  let applied = $state(false);
  let copying = $state(false);
  let copied = $state(false);
  let manualPrompt = $state('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  onDestroy(() => { disposed = true; if (copiedTimer) clearTimeout(copiedTimer); });

  async function copyPrompt(): Promise<void> {
    if (copying) return;
    copying = true;
    error = '';
    manualPrompt = '';
    const currentPrompt = prompt;
    try {
      await navigator.clipboard.writeText(currentPrompt);
      if (disposed) return;
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; }, 2000);
    } catch {
      if (!disposed) {
        error = 'Could not copy automatically. Copy the prompt from the field below.';
        manualPrompt = currentPrompt;
      }
    } finally { if (!disposed) copying = false; }
  }

  function apply(): void {
    error = '';
    applied = false;
    manualPrompt = '';
    try {
      const parsed = parseAIInput(input, folders);
      onApply(parsed);
      applied = true;
    } catch (cause) { error = errorMessage(cause); }
  }
</script>

<section class="space-y-2 rounded-xl border border-primary/20 bg-primary/3 p-3" aria-labelledby={`${id}-title`}>
  <div class="flex min-w-0 items-center gap-3">
    <label id={`${id}-title`} for={`${id}-input`} class="flex shrink-0 items-center gap-2 text-sm font-semibold"><SparklesIcon class="size-4 text-link" />AI input</label>
    <p id={`${id}-help`} class="text-xs leading-4 text-muted-foreground">Copy → ChatGPT → paste.</p>
  </div>
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
    <Textarea id={`${id}-input`} bind:value={input} rows={1} maxlength={aiInputLimit}
      placeholder="Paste the filled template from ChatGPT…"
      aria-describedby={`${id}-help${error && !manualPrompt ? ' ' + id + '-error' : ''}`} aria-invalid={!!error && !manualPrompt}
      oninput={() => { error = ''; applied = false; }}
      class="col-span-2 h-9 min-h-9 field-sizing-fixed resize-none py-1.5 text-sm leading-5 sm:col-span-1" />
    <Button variant="outline" size="sm" class="w-24 justify-self-end sm:justify-self-auto" aria-label={copied ? 'Prompt copied' : 'Copy prompt'} onclick={() => void copyPrompt()} disabled={copying}>
      {#if copied}<CheckIcon class="size-4 text-link" />Copied{:else}<CopyIcon class="size-4" />Copy{/if}
    </Button>
    <Button variant="secondary" size="sm" class="justify-self-start sm:justify-self-auto" onclick={apply} disabled={!input.trim()}>Apply</Button>
  </div>
  <span class="sr-only" role="status">{copied ? 'Prompt copied to clipboard.' : ''}</span>
  {#if error}<p id={`${id}-error`} class="text-xs leading-5 text-destructive" role="alert">{error}</p>{/if}
  {#if manualPrompt}
    <Textarea aria-label="Prompt for manual copying" value={manualPrompt} readonly rows={4}
      onfocus={(event) => event.currentTarget.select()} class="max-h-36 text-xs" />
  {/if}
  {#if applied}<p class="flex items-start gap-1.5 text-xs leading-5 text-link" role="status"><CheckIcon class="mt-0.5 size-3.5 shrink-0" />Fields filled. Review your card, then choose {saveLabel}.</p>{/if}
</section>
