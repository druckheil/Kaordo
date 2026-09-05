<script lang="ts">
  import { onMount } from 'svelte';
  import DialogShell from './dialog/DialogShell.svelte';

  type Props = {
    busy: boolean;
    currentTitle: string;
    error: string | null;
    onRename: (title: string) => void | Promise<void>;
    onCancel: () => void | Promise<void>;
  };

  const MAX_PANEL_TITLE_BYTES = 200;

  let {
    busy,
    currentTitle,
    error,
    onRename,
    onCancel,
  }: Props = $props();
  let inputElement = $state<HTMLInputElement>();
  let title = $state('');
  let titleError = $state<string | null>(null);
  let visibleRenameError = $state<string | null>(null);

  $effect(() => {
    visibleRenameError = error;
  });

  onMount(() => {
    title = currentTitle;
    inputElement?.focus();
    inputElement?.select();
  });

  function handleInput(event: Event) {
    title = (event.currentTarget as HTMLInputElement).value;
    titleError = null;
    visibleRenameError = null;
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      titleError = 'Enter a panel title.';
      inputElement?.focus();
      return;
    }
    if (new TextEncoder().encode(normalizedTitle).byteLength > MAX_PANEL_TITLE_BYTES) {
      titleError = `Panel titles must be ${MAX_PANEL_TITLE_BYTES} bytes or fewer.`;
      inputElement?.focus();
      return;
    }

    titleError = null;
    await onRename(normalizedTitle);
  }
</script>

<DialogShell
  {busy}
  descriptionId="rename-panel-description"
  eyebrow="Panel settings"
  {onCancel}
  onSubmit={handleSubmit}
  submitLabel="Save name"
  submittingLabel="Saving…"
  title="Rename panel"
  titleId="rename-panel-title"
  variant="panel"
>
  {#snippet icon()}
    <svg viewBox="0 0 24 24" role="presentation">
      <path d="M6 4.5h9l3 3v12H6zM15 4.5v3h3M9 11h6M9 14h3" />
      <path d="m13.5 16.5 4.5-4.5 1.5 1.5-4.5 4.5-2 .5z" />
    </svg>
  {/snippet}

  <p id="rename-panel-description" class="dialog-description">
    Choose a clear name for this knowledge panel.
  </p>

  <div class="dialog-field">
    <label for="rename-panel-title-input">Panel title</label>
    <div class="panel-title-control">
      <input
        id="rename-panel-title-input"
        bind:this={inputElement}
        value={title}
        type="text"
        maxlength="200"
        required
        autocomplete="off"
        disabled={busy}
        aria-describedby={titleError
          ? 'rename-panel-title-help rename-panel-title-error'
          : visibleRenameError
            ? 'rename-panel-title-help rename-panel-error'
            : 'rename-panel-title-help'}
        aria-invalid={titleError || visibleRenameError ? 'true' : undefined}
        oninput={handleInput}
      />
    </div>
    <p id="rename-panel-title-help">Use a short, descriptive title.</p>
  </div>

  {#if titleError}
    <p id="rename-panel-title-error" class="dialog-error" role="alert">
      {titleError}
    </p>
  {:else if visibleRenameError}
    <p id="rename-panel-error" class="dialog-error" role="alert">
      {visibleRenameError}
    </p>
  {/if}
</DialogShell>

<style>
  .panel-title-control {
    height: 42px;
    overflow: hidden;
    background: #fff;
    border: 1px solid #bdc4be;
    border-radius: 8px;
    box-shadow: inset 0 1px 2px rgb(27 42 35 / 4%);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .panel-title-control:focus-within {
    border-color: #518b7c;
    box-shadow: 0 0 0 3px rgb(55 117 102 / 13%);
  }

  .panel-title-control input {
    width: 100%;
    height: 100%;
    padding: 0 12px;
    color: #252c28;
    background: transparent;
    border: 0;
    outline: none;
    font-size: calc(13px * var(--text-scale));
  }

  @media (prefers-reduced-motion: reduce) {
    .panel-title-control { transition: none; }
  }
</style>
