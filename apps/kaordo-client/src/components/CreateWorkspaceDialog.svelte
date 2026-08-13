<script lang="ts">
  import { onMount } from 'svelte';
  import DialogShell from './dialog/DialogShell.svelte';

  type Props = {
    busy: boolean;
    error: string | null;
    onCreate: (name: string) => void | Promise<void>;
    onCancel: () => void | Promise<void>;
    platform: 'desktop' | 'web';
    storageLocation: string;
  };

  let {
    busy,
    error,
    onCreate,
    onCancel,
    platform,
    storageLocation,
  }: Props = $props();
  let inputElement = $state<HTMLInputElement>();
  let name = $state('');
  let nameError = $state<string | null>(null);

  onMount(() => focusInput());

  export function focusInput() {
    inputElement?.focus();
  }

  function handleInput(event: Event) {
    name = withoutWorkspaceExtension(
      (event.currentTarget as HTMLInputElement).value,
    );
    nameError = null;
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;

    const normalizedName = name.trim();
    if (!normalizedName) {
      nameError = 'Enter a workspace name.';
      focusInput();
      return;
    }

    nameError = null;
    await onCreate(normalizedName);
  }

  function withoutWorkspaceExtension(value: string): string {
    let normalizedName = value;
    while (normalizedName.toLowerCase().endsWith('.vdw')) {
      normalizedName = normalizedName.slice(0, -4);
    }
    return normalizedName;
  }
</script>

<DialogShell
  {busy}
  descriptionId="create-workspace-description"
  eyebrow="New file"
  {onCancel}
  onSubmit={handleSubmit}
  submitLabel="Create workspace"
  submittingLabel="Creating…"
  title="Create workspace"
  titleId="create-workspace-title"
>
  {#snippet icon()}
    <svg viewBox="0 0 24 24" role="presentation">
      <path d="M5 5.5h14v13H5zM8 9h8M8 12h8M8 15h5" />
    </svg>
  {/snippet}

  <p id="create-workspace-description" class="dialog-description">
    {platform === 'desktop'
      ? 'Give your portable workspace a clear name. You can rename it later.'
      : 'Give your browser workspace a clear name. It stays on this device.'}
  </p>

  <div class="dialog-field">
    <label for="workspace-name">Workspace name</label>
    <div class="workspace-name-control">
      <input
        id="workspace-name"
        bind:this={inputElement}
        value={name}
        type="text"
        maxlength="120"
        required
        autocomplete="off"
        placeholder="Untitled workspace"
        disabled={busy}
        aria-describedby={nameError
          ? 'workspace-name-help workspace-name-error'
          : 'workspace-name-help'}
        aria-invalid={nameError ? 'true' : undefined}
        oninput={handleInput}
      />
      <span aria-hidden="true">.vdw</span>
    </div>
    <p id="workspace-name-help">The file extension is added automatically.</p>
  </div>

  <div class="library-location">
    <span class="location-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="presentation">
        <path d="M3.5 7.5h7l1.8 2H20.5v8.8a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" />
      </svg>
    </span>
    <span>
      <small>Saved in</small>
      <strong>{storageLocation}</strong>
    </span>
  </div>

  {#if nameError}
    <p id="workspace-name-error" class="dialog-error" role="alert">
      {nameError}
    </p>
  {:else if error}
    <p class="dialog-error" role="alert">{error}</p>
  {/if}
</DialogShell>

<style>
  .workspace-name-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
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

  .workspace-name-control:focus-within {
    border-color: #518b7c;
    box-shadow: 0 0 0 3px rgb(55 117 102 / 13%);
  }

  .workspace-name-control input {
    width: 100%;
    min-width: 0;
    height: 100%;
    padding: 0 12px;
    color: #252c28;
    background: transparent;
    border: 0;
    outline: none;
    font-size: calc(13px * var(--text-scale));
  }

  .workspace-name-control input::placeholder {
    color: #9aa19c;
  }

  .workspace-name-control > span {
    display: flex;
    align-items: center;
    align-self: stretch;
    padding: 0 12px;
    color: #778079;
    background: #f2f4f0;
    border-left: 1px solid #d9ddd7;
    font-size: calc(12px * var(--text-scale));
    font-weight: 620;
  }

  .library-location {
    display: flex;
    align-items: center;
    gap: 11px;
    min-height: 54px;
    margin-top: 18px;
    padding: 9px 12px;
    background: #f1f4f0;
    border: 1px solid #dce1db;
    border-radius: 9px;
  }

  .location-icon {
    display: grid;
    flex: none;
    width: 30px;
    height: 30px;
    color: #568879;
    background: #e4eee9;
    border-radius: 7px;
    place-items: center;
  }

  .location-icon svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .library-location small,
  .library-location strong {
    display: block;
  }

  .library-location small {
    margin-bottom: 3px;
    color: #7a827c;
    font-size: calc(9px * var(--text-scale));
    font-weight: 680;
    letter-spacing: 0.09em;
    line-height: 1;
    text-transform: uppercase;
  }

  .library-location strong {
    color: #3d4640;
    font-size: calc(11px * var(--text-scale));
    font-weight: 620;
  }

  @media (prefers-reduced-motion: reduce) {
    .workspace-name-control {
      transition: none;
    }
  }
</style>
