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

  const MAX_OBJECT_TITLE_BYTES = 200;

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
      titleError = 'Enter an object title.';
      focusInput();
      return;
    }
    if (new TextEncoder().encode(normalizedTitle).byteLength > MAX_OBJECT_TITLE_BYTES) {
      titleError = `Object titles must be ${MAX_OBJECT_TITLE_BYTES} bytes or fewer.`;
      focusInput();
      return;
    }

    titleError = null;
    await onCreate(normalizedTitle);
  }
</script>

<DialogShell
  {busy}
  descriptionId="create-object-description"
  eyebrow="New content"
  {onCancel}
  onSubmit={handleSubmit}
  submitLabel="Create object"
  submittingLabel="Creating…"
  title="Create object"
  titleId="create-object-title"
  variant="object"
>
  {#snippet icon()}
    <svg viewBox="0 0 24 24" role="presentation">
      <path d="M6 4.5h9l3 3v12H6zM15 4.5v3h3M9 11h6M9 14h6" />
    </svg>
  {/snippet}

  <p id="create-object-description" class="dialog-description">
    Add a knowledge object to {workspaceName}.vdw.
  </p>

  <div class="dialog-field">
    <label for="object-title">Object title</label>
    <div class="object-title-control">
      <input
        id="object-title"
        bind:this={inputElement}
        value={title}
        type="text"
        maxlength="200"
        required
        autocomplete="off"
        placeholder="Untitled object"
        disabled={busy}
        aria-describedby={titleError
          ? 'object-title-help object-title-error'
          : visibleCreateError
            ? 'object-title-help object-create-error'
            : 'object-title-help'}
        aria-invalid={titleError || visibleCreateError ? 'true' : undefined}
        oninput={handleInput}
      />
    </div>
    <p id="object-title-help">Use a short, descriptive title.</p>
  </div>

  {#if titleError}
    <p id="object-title-error" class="dialog-error" role="alert">
      {titleError}
    </p>
  {:else if visibleCreateError}
    <p id="object-create-error" class="dialog-error" role="alert">
      {visibleCreateError}
    </p>
  {/if}
</DialogShell>

<style>
  .object-title-control {
    height: 42px;
    overflow: hidden;
    background: #fff;
    border: 1px solid #bdc4be;
    border-radius: 8px;
    box-shadow: inset 0 1px 2px rgb(27 42 35 / 4%);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .object-title-control:focus-within {
    border-color: #518b7c;
    box-shadow: 0 0 0 3px rgb(55 117 102 / 13%);
  }

  .object-title-control input {
    width: 100%;
    height: 100%;
    padding: 0 12px;
    color: #252c28;
    background: transparent;
    border: 0;
    outline: none;
    font-size: calc(13px * var(--text-scale));
  }

  .object-title-control input::placeholder {
    color: #9aa19c;
  }

  @media (prefers-reduced-motion: reduce) {
    .object-title-control {
      transition: none;
    }
  }
</style>
