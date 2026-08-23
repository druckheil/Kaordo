<script lang="ts">
  import { onMount } from 'svelte';
  import DialogShell from './dialog/DialogShell.svelte';

  type Props = {
    workspaceName: string;
    busy: boolean;
    error: string | null;
    onCreate: (title: string) => void | Promise<void>;
    onCancel: () => void | Promise<void>;
  };

  const MAX_PANEL_TITLE_BYTES = 200;

  let { workspaceName, busy, error, onCreate, onCancel }: Props = $props();
  let inputElement = $state<HTMLInputElement>();
  let title = $state('');
  let titleError = $state<string | null>(null);
  let visibleCreateError = $state<string | null>(null);

  $effect(() => {
    visibleCreateError = error;
  });

  onMount(() => focusInput());

  export function focusInput() {
    inputElement?.focus();
  }

  function handleInput(event: Event) {
    title = (event.currentTarget as HTMLInputElement).value;
    titleError = null;
    visibleCreateError = null;
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      titleError = 'Enter a panel title.';
      focusInput();
      return;
    }
    if (new TextEncoder().encode(normalizedTitle).byteLength > MAX_PANEL_TITLE_BYTES) {
      titleError = `Panel titles must be ${MAX_PANEL_TITLE_BYTES} bytes or fewer.`;
      focusInput();
      return;
    }

    titleError = null;
    await onCreate(normalizedTitle);
  }
</script>

<DialogShell
  {busy}
  descriptionId="create-panel-description"
  eyebrow="New content"
  {onCancel}
  onSubmit={handleSubmit}
  submitLabel="Create panel"
  submittingLabel="Creating…"
  title="Create panel"
  titleId="create-panel-title"
  variant="panel"
>
  {#snippet icon()}
    <svg viewBox="0 0 24 24" role="presentation">
      <path d="M6 4.5h9l3 3v12H6zM15 4.5v3h3M9 11h6M9 14h6" />
    </svg>
  {/snippet}

  <p id="create-panel-description" class="dialog-description">
    Add a knowledge panel to {workspaceName}.vdw.
  </p>

  <div class="dialog-field">
    <label for="panel-title">Panel title</label>
    <div class="panel-title-control">
      <input
        id="panel-title"
        bind:this={inputElement}
        value={title}
        type="text"
        maxlength="200"
        required
        autocomplete="off"
        placeholder="Untitled panel"
        disabled={busy}
        aria-describedby={titleError
          ? 'panel-title-help panel-title-error'
          : visibleCreateError
            ? 'panel-title-help panel-create-error'
            : 'panel-title-help'}
        aria-invalid={titleError || visibleCreateError ? 'true' : undefined}
        oninput={handleInput}
      />
    </div>
    <p id="panel-title-help">Use a short, descriptive title.</p>
  </div>

  {#if titleError}
    <p id="panel-title-error" class="dialog-error" role="alert">
      {titleError}
    </p>
  {:else if visibleCreateError}
    <p id="panel-create-error" class="dialog-error" role="alert">
      {visibleCreateError}
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

  .panel-title-control input::placeholder { color: #9aa19c; }

  @media (prefers-reduced-motion: reduce) {
    .panel-title-control { transition: none; }
  }
</style>
