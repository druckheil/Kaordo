<script lang="ts">
  import { onDestroy } from 'svelte';
  import DialogShell from './DialogShell.svelte';

  export type ProfileEditValues = {
    avatar: Blob | null | undefined;
    description: string;
    nickname: string;
  };

  type Props = {
    avatarUrl: string | null;
    busy: boolean;
    description: string;
    error: string | null;
    nickname: string;
    onCancel: () => void | Promise<void>;
    onSubmit: (values: ProfileEditValues) => void | Promise<void>;
  };

  let {
    avatarUrl,
    busy,
    description,
    error,
    nickname,
    onCancel,
    onSubmit,
  }: Props = $props();
  let selectedAvatar = $state<Blob | null | undefined>(undefined);
  let selectedAvatarUrl = $state<string | null>(null);
  let avatarInput = $state<HTMLInputElement>();
  let fieldError = $state<string | null>(null);
  let avatarRemovalRequested = $derived(selectedAvatar === null);

  function chooseAvatar(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    fieldError = null;
    if (file.size > 4 * 1024 * 1024) {
      fieldError = 'Avatar must be 4 MB or smaller.';
      (event.currentTarget as HTMLInputElement).value = '';
      return;
    }
    if (!file.type.startsWith('image/')) {
      fieldError = 'Avatar must be an image.';
      (event.currentTarget as HTMLInputElement).value = '';
      return;
    }
    revokeSelectedAvatarUrl();
    selectedAvatar = file;
    selectedAvatarUrl = URL.createObjectURL(file);
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    fieldError = null;
    const nextNickname = nickname.trim();
    if (!nextNickname || nextNickname.length > 64) {
      fieldError = 'Nickname must be 1–64 characters.';
      return;
    }
    if (description.trim().length > 280) {
      fieldError = 'Description must be 280 characters or less.';
      return;
    }
    await onSubmit({ avatar: selectedAvatar, description: description.trim(), nickname: nextNickname });
  }

  function removeAvatar(): void {
    revokeSelectedAvatarUrl();
    selectedAvatar = null;
    if (avatarInput) avatarInput.value = '';
  }

  function revokeSelectedAvatarUrl(): void {
    if (selectedAvatarUrl?.startsWith('blob:')) URL.revokeObjectURL(selectedAvatarUrl);
    selectedAvatarUrl = null;
  }

  onDestroy(revokeSelectedAvatarUrl);
</script>

<DialogShell
  {busy}
  descriptionId="profile-edit-description"
  eyebrow="Public profile"
  onCancel={onCancel}
  onSubmit={submit}
  submitLabel="Save profile"
  submittingLabel="Saving…"
  title="Edit profile"
  titleId="profile-edit-title"
  variant="settings"
>
  {#snippet icon()}
    <svg viewBox="0 0 24 24" role="presentation"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 19c.7-3.4 2.9-5.1 6.5-5.1s5.8 1.7 6.5 5.1M17.2 5.2l1.5 1.5 2.9-2.9" /></svg>
  {/snippet}

  <p id="profile-edit-description" class="dialog-description">
    This information is stored on your Public Nodo. Your username remains unchanged.
  </p>

  <div class="profile-avatar-editor">
    <div class="profile-avatar-preview">
      {#if selectedAvatarUrl}
        <img src={selectedAvatarUrl} alt="New avatar preview" />
      {:else if avatarUrl && !avatarRemovalRequested}
        <img src={avatarUrl} alt="Current avatar" />
      {:else}
        <span aria-hidden="true">{nickname.slice(0, 1).toUpperCase() || '?'}</span>
      {/if}
    </div>
    <div>
      <strong>Avatar</strong>
      <p>Image files up to 4 MB.</p>
      <div class="avatar-actions">
        <button type="button" class="avatar-button" disabled={busy} onclick={() => avatarInput?.click()}>Choose image</button>
        {#if (avatarUrl && !avatarRemovalRequested) || selectedAvatar}
          <button type="button" class="avatar-remove" disabled={busy} onclick={removeAvatar}>Remove</button>
        {/if}
      </div>
      <input bind:this={avatarInput} class="hidden-file" accept="image/*" disabled={busy} onchange={chooseAvatar} type="file" />
    </div>
  </div>

  <div class="dialog-field">
    <label for="profile-nickname">Nickname</label>
    <input id="profile-nickname" bind:value={nickname} maxlength="64" disabled={busy} placeholder="How people should call you" required type="text" />
  </div>

  <div class="dialog-field">
    <label for="profile-description">Description</label>
    <textarea id="profile-description" bind:value={description} maxlength="280" disabled={busy} placeholder="A short description about you" rows="4"></textarea>
    <p>{description.length}/280</p>
  </div>

  {#if fieldError}
    <p class="dialog-error" role="alert">{fieldError}</p>
  {:else if error}
    <p class="dialog-error" role="alert">{error}</p>
  {/if}
</DialogShell>

<style>
  .profile-avatar-editor { display: flex; align-items: center; gap: 13px; margin-top: 16px; padding: 13px; color: var(--sui-text, #2d3748); background: var(--sui-bg, #e4e9f0); border: 0; border-radius: 14px; box-shadow: var(--sui-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%)); }
  .profile-avatar-preview { display: grid; width: 62px; height: 62px; flex: none; overflow: hidden; color: #fff; background: linear-gradient(145deg, var(--sui-primary, #5b54e0), color-mix(in srgb, var(--sui-primary, #5b54e0) 62%, #25314d)); border-radius: 19px; box-shadow: var(--sui-shadow-raised-sm, 0 5px 12px rgb(39 51 67 / 17%)); font-size: calc(21px * var(--text-scale)); font-weight: 720; place-items: center; }
  .profile-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
  .profile-avatar-editor strong { display: block; color: var(--sui-text, #2d3748); font-size: calc(10px * var(--text-scale)); }
  .profile-avatar-editor p { margin-top: 3px; color: var(--sui-text-light, #6a7d94); font-size: calc(8px * var(--text-scale)); }
  .avatar-actions { display: flex; gap: 7px; margin-top: 8px; }
  .avatar-button, .avatar-remove { height: 29px; padding: 0 10px; border: 0; border-radius: 9px; box-shadow: var(--sui-shadow-raised-sm, 0 4px 10px rgb(39 51 67 / 17%)); cursor: pointer; font: inherit; font-size: calc(8px * var(--text-scale)); font-weight: 690; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .avatar-button { color: var(--sui-primary, #5b54e0); background: var(--sui-bg, #e4e9f0); }
  .avatar-remove { color: var(--sui-danger, #c95667); background: var(--sui-bg, #e4e9f0); }
  .avatar-button:hover:not(:disabled), .avatar-remove:hover:not(:disabled) { transform: translateY(-1px); }
  .avatar-button:active:not(:disabled), .avatar-remove:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 17%)); transform: translateY(1px); }
  .avatar-button:disabled, .avatar-remove:disabled { cursor: default; opacity: .55; }
  .hidden-file { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
  textarea { width: 100%; resize: vertical; }
</style>
