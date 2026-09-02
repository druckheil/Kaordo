<script lang="ts">
  import { onMount } from 'svelte';
  import DialogShell from './DialogShell.svelte';

  export type AccountChangeMode = 'username' | 'password';
  export type AccountChangeValues =
    | { currentPassword: string; kind: 'username'; newUsername: string }
    | { confirmPassword: string; currentPassword: string; kind: 'password'; newPassword: string };

  type Props = {
    busy: boolean;
    error: string | null;
    mode: AccountChangeMode;
    onCancel: () => void | Promise<void>;
    onSubmit: (values: AccountChangeValues) => void | Promise<void>;
    username: string;
  };

  let {
    busy,
    error,
    mode,
    onCancel,
    onSubmit,
    username,
  }: Props = $props();
  let inputElement = $state<HTMLInputElement>();
  let currentPasswordInput = $state<HTMLInputElement>();
  let newUsername = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let fieldError = $state<string | null>(null);

  onMount(() => {
    newUsername = username;
    (mode === 'username' ? inputElement : currentPasswordInput)?.focus();
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    fieldError = null;

    if (mode === 'username') {
      const normalized = newUsername.trim();
      if (!/^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$/iu.test(normalized)) {
        fieldError = 'Username must be 3–32 characters using letters, numbers, or inner underscores.';
        inputElement?.focus();
        return;
      }
      if (!currentPassword) {
        fieldError = 'Enter your current password.';
        return;
      }
      await onSubmit({ currentPassword, kind: 'username', newUsername: normalized });
      return;
    }

    if (!currentPassword) {
      fieldError = 'Enter your current password.';
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 32) {
      fieldError = 'New password must be 6–32 characters.';
      return;
    }
    if (newPassword !== confirmPassword) {
      fieldError = 'New passwords do not match.';
      return;
    }
    await onSubmit({
      confirmPassword,
      currentPassword,
      kind: 'password',
      newPassword,
    });
  }
</script>

<DialogShell
  {busy}
  descriptionId="account-change-description"
  eyebrow={mode === 'username' ? 'Account identity' : 'Account security'}
  {onCancel}
  onSubmit={handleSubmit}
  submitLabel={mode === 'username' ? 'Save username' : 'Change password'}
  submittingLabel={mode === 'username' ? 'Saving…' : 'Changing…'}
  title={mode === 'username' ? 'Change username' : 'Change password'}
  titleId="account-change-title"
  variant="settings"
>
  {#snippet icon()}
    {#if mode === 'username'}
      <svg viewBox="0 0 24 24" role="presentation"><circle cx="12" cy="8" r="3.3" /><path d="M5.5 19c.7-3.4 2.9-5.1 6.5-5.1s5.8 1.7 6.5 5.1M17.2 5.2l1.5 1.5 2.9-2.9" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" role="presentation"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2.5" /></svg>
    {/if}
  {/snippet}

  <p id="account-change-description" class="dialog-description">
    {#if mode === 'username'}
      Choose the name other people will see. Your current password is required to confirm this change.
    {:else}
      Set a new password for <strong>{username}</strong>. Other signed-in devices will be logged out.
    {/if}
  </p>

  {#if mode === 'username'}
    <div class="dialog-field">
      <label for="new-username">New username</label>
      <input
        id="new-username"
        bind:this={inputElement}
        bind:value={newUsername}
        autocomplete="username"
        maxlength="32"
        placeholder="Your username"
        disabled={busy}
        required
        type="text"
      />
      <p>Letters, numbers, and inner underscores only.</p>
    </div>
  {/if}

  <div class="dialog-field">
    <label for="current-account-password">Current password</label>
    <input
      id="current-account-password"
      bind:this={currentPasswordInput}
      bind:value={currentPassword}
      autocomplete="current-password"
      maxlength="128"
      placeholder="Your current password"
      disabled={busy}
      required
      type="password"
    />
  </div>

  {#if mode === 'password'}
    <div class="dialog-field">
      <label for="new-account-password">New password</label>
      <input
        id="new-account-password"
        bind:value={newPassword}
        autocomplete="new-password"
        maxlength="32"
        placeholder="6–32 characters"
        disabled={busy}
        required
        type="password"
      />
    </div>
    <div class="dialog-field">
      <label for="confirm-account-password">Confirm new password</label>
      <input
        id="confirm-account-password"
        bind:value={confirmPassword}
        autocomplete="new-password"
        maxlength="32"
        placeholder="Repeat the new password"
        disabled={busy}
        required
        type="password"
      />
    </div>
  {/if}

  {#if fieldError}
    <p class="dialog-error" role="alert">{fieldError}</p>
  {:else if error}
    <p class="dialog-error" role="alert">{error}</p>
  {/if}
</DialogShell>
