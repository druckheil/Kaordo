<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ProfileAccent } from '../../lib/domain/profile';
  import DialogShell from './DialogShell.svelte';

  export type ProfileEditValues = {
    accentColor: ProfileAccent | null;
    avatar: Blob | null | undefined;
    banner: Blob | null | undefined;
    description: string;
    headline: string;
    location: string;
    nickname: string;
    pronouns: string;
    status: string;
    website: string;
  };

  type Props = {
    accentColor: ProfileAccent | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    busy: boolean;
    description: string;
    error: string | null;
    headline: string;
    location: string;
    nickname: string;
    onCancel: () => void | Promise<void>;
    onSubmit: (values: ProfileEditValues) => void | Promise<void>;
    pronouns: string;
    status: string;
    website: string;
  };

  const accentOptions: { id: ProfileAccent; label: string; color: string }[] = [
    { id: 'violet', label: 'Violet', color: '#5b54e0' },
    { id: 'ocean', label: 'Ocean', color: '#3278b7' },
    { id: 'mint', label: 'Mint', color: '#269875' },
    { id: 'sunset', label: 'Sunset', color: '#c56d54' },
  ];

  let {
    accentColor,
    avatarUrl,
    bannerUrl,
    busy,
    description,
    error,
    headline,
    location,
    nickname,
    onCancel,
    onSubmit,
    pronouns,
    status,
    website,
  }: Props = $props();
  let selectedAvatar = $state<Blob | null | undefined>(undefined);
  let selectedAvatarUrl = $state<string | null>(null);
  let selectedBanner = $state<Blob | null | undefined>(undefined);
  let selectedBannerUrl = $state<string | null>(null);
  let avatarInput = $state<HTMLInputElement>();
  let bannerInput = $state<HTMLInputElement>();
  let fieldError = $state<string | null>(null);
  let avatarRemovalRequested = $derived(selectedAvatar === null);
  let bannerRemovalRequested = $derived(selectedBanner === null);

  function chooseAvatar(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const accepted = validateImage(file, 'Avatar', 4 * 1024 * 1024);
    if (!accepted) {
      (event.currentTarget as HTMLInputElement).value = '';
      return;
    }
    revokeSelectedAvatarUrl();
    fieldError = null;
    selectedAvatar = file;
    selectedAvatarUrl = URL.createObjectURL(file);
  }

  function chooseBanner(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const accepted = validateImage(file, 'Banner', 8 * 1024 * 1024);
    if (!accepted) {
      (event.currentTarget as HTMLInputElement).value = '';
      return;
    }
    revokeSelectedBannerUrl();
    fieldError = null;
    selectedBanner = file;
    selectedBannerUrl = URL.createObjectURL(file);
  }

  function validateImage(file: File, label: string, maximum: number): boolean {
    if (file.size > maximum) {
      fieldError = `${label} must be ${Math.round(maximum / (1024 * 1024))} MB or smaller.`;
      return false;
    }
    if (!file.type.startsWith('image/')) {
      fieldError = `${label} must be an image.`;
      return false;
    }
    return true;
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
    if (headline.trim().length > 120) {
      fieldError = 'Headline must be 120 characters or less.';
      return;
    }
    if (pronouns.trim().length > 48) {
      fieldError = 'Pronouns must be 48 characters or less.';
      return;
    }
    if (location.trim().length > 80) {
      fieldError = 'Location must be 80 characters or less.';
      return;
    }
    if (status.trim().length > 100) {
      fieldError = 'Status must be 100 characters or less.';
      return;
    }
    const nextWebsite = website.trim();
    if (nextWebsite && nextWebsite.length > 200) {
      fieldError = 'Website must be 200 characters or less.';
      return;
    }
    if (nextWebsite && !isWebsite(nextWebsite)) {
      fieldError = 'Website must start with https:// or http://.';
      return;
    }
    await onSubmit({
      accentColor,
      avatar: selectedAvatar,
      banner: selectedBanner,
      description: description.trim(),
      headline: headline.trim(),
      location: location.trim(),
      nickname: nextNickname,
      pronouns: pronouns.trim(),
      status: status.trim(),
      website: nextWebsite,
    });
  }

  function removeAvatar(): void {
    revokeSelectedAvatarUrl();
    selectedAvatar = null;
    if (avatarInput) avatarInput.value = '';
  }

  function removeBanner(): void {
    revokeSelectedBannerUrl();
    selectedBanner = null;
    if (bannerInput) bannerInput.value = '';
  }

  function revokeSelectedAvatarUrl(): void {
    revokeUrl(selectedAvatarUrl);
    selectedAvatarUrl = null;
  }

  function revokeSelectedBannerUrl(): void {
    revokeUrl(selectedBannerUrl);
    selectedBannerUrl = null;
  }

  function revokeUrl(url: string | null): void {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  function isWebsite(value: string): boolean {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  onDestroy(() => {
    revokeSelectedAvatarUrl();
    revokeSelectedBannerUrl();
  });
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
    Shape the public profile other people see. Every detail below is optional except your nickname.
  </p>

  <section class="profile-banner-editor" aria-labelledby="profile-banner-label">
    <div class="profile-banner-preview" class:profile-banner-preview--empty={!selectedBannerUrl && (!bannerUrl || bannerRemovalRequested)}>
      {#if selectedBannerUrl}
        <img src={selectedBannerUrl} alt="New banner preview" />
      {:else if bannerUrl && !bannerRemovalRequested}
        <img src={bannerUrl} alt="Current banner" />
      {:else}
        <span class="banner-placeholder" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="banner-placeholder-label">Optional banner</span>
      {/if}
    </div>
    <div class="profile-media-copy">
      <strong id="profile-banner-label">Profile banner</strong>
      <p>A wide image up to 8 MB. Leave it empty for a clean gradient.</p>
      <div class="media-actions">
        <button type="button" class="media-button" disabled={busy} onclick={() => bannerInput?.click()}>Choose banner</button>
        {#if (bannerUrl && !bannerRemovalRequested) || selectedBanner}
          <button type="button" class="media-remove" disabled={busy} onclick={removeBanner}>Remove</button>
        {/if}
      </div>
      <input bind:this={bannerInput} class="hidden-file" accept="image/*" disabled={busy} onchange={chooseBanner} type="file" />
    </div>
  </section>

  <section class="profile-avatar-editor" aria-labelledby="profile-avatar-label">
    <div class="profile-avatar-preview">
      {#if selectedAvatarUrl}
        <img src={selectedAvatarUrl} alt="New avatar preview" />
      {:else if avatarUrl && !avatarRemovalRequested}
        <img src={avatarUrl} alt="Current avatar" />
      {:else}
        <span aria-hidden="true">{nickname.slice(0, 1).toUpperCase() || '?'}</span>
      {/if}
    </div>
    <div class="profile-media-copy">
      <strong id="profile-avatar-label">Avatar</strong>
      <p>Square image up to 4 MB.</p>
      <div class="media-actions">
        <button type="button" class="media-button" disabled={busy} onclick={() => avatarInput?.click()}>Choose image</button>
        {#if (avatarUrl && !avatarRemovalRequested) || selectedAvatar}
          <button type="button" class="media-remove" disabled={busy} onclick={removeAvatar}>Remove</button>
        {/if}
      </div>
      <input bind:this={avatarInput} class="hidden-file" accept="image/*" disabled={busy} onchange={chooseAvatar} type="file" />
    </div>
  </section>

  <div class="dialog-field">
    <label for="profile-nickname">Nickname <span class="field-optional">required</span></label>
    <input id="profile-nickname" bind:value={nickname} maxlength="64" disabled={busy} placeholder="How people should call you" required type="text" />
  </div>

  <div class="profile-field-grid">
    <div class="dialog-field">
      <label for="profile-headline">Headline <span class="field-optional">optional</span></label>
      <input id="profile-headline" bind:value={headline} maxlength="120" disabled={busy} placeholder="What you are working on" type="text" />
      <p>{headline.length}/120</p>
    </div>
    <div class="dialog-field">
      <label for="profile-status">Status <span class="field-optional">optional</span></label>
      <input id="profile-status" bind:value={status} maxlength="100" disabled={busy} placeholder="A small sign of life" type="text" />
      <p>{status.length}/100</p>
    </div>
    <div class="dialog-field">
      <label for="profile-pronouns">Pronouns <span class="field-optional">optional</span></label>
      <input id="profile-pronouns" bind:value={pronouns} maxlength="48" disabled={busy} placeholder="they / them" type="text" />
    </div>
    <div class="dialog-field">
      <label for="profile-location">Location <span class="field-optional">optional</span></label>
      <input id="profile-location" bind:value={location} maxlength="80" disabled={busy} placeholder="Berlin, Earth" type="text" />
    </div>
  </div>

  <div class="dialog-field">
    <label for="profile-website">Website <span class="field-optional">optional</span></label>
    <input id="profile-website" bind:value={website} maxlength="200" disabled={busy} placeholder="https://example.com" type="url" />
  </div>

  <div class="dialog-field">
    <label for="profile-description">Description <span class="field-optional">optional</span></label>
    <textarea id="profile-description" bind:value={description} maxlength="280" disabled={busy} placeholder="A short description about you" rows="4"></textarea>
    <p>{description.length}/280</p>
  </div>

  <fieldset class="accent-picker" disabled={busy}>
    <legend>Accent color <span class="field-optional">optional</span></legend>
    <div class="accent-options">
      <button class:accent-option--active={accentColor === null} type="button" class="accent-option accent-option--default" aria-pressed={accentColor === null} onclick={() => (accentColor = null)}>
        <span class="accent-swatch" aria-hidden="true"></span>
        Default
      </button>
      {#each accentOptions as option (option.id)}
        <button
          class:accent-option--active={accentColor === option.id}
          class="accent-option"
          type="button"
          aria-pressed={accentColor === option.id}
          onclick={() => (accentColor = option.id)}
        >
          <span class="accent-swatch" style={`--accent-swatch: ${option.color}`} aria-hidden="true"></span>
          {option.label}
        </button>
      {/each}
    </div>
  </fieldset>

  {#if fieldError}
    <p class="dialog-error" role="alert">{fieldError}</p>
  {:else if error}
    <p class="dialog-error" role="alert">{error}</p>
  {/if}
</DialogShell>

<style>
  .profile-banner-editor,
  .profile-avatar-editor {
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--sui-text, #2d3748);
    background: var(--sui-bg, #e4e9f0);
    border: 0;
    box-shadow: var(--sui-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%));
  }

  .profile-banner-editor {
    flex-direction: column;
    align-items: stretch;
    gap: 11px;
    margin-top: 16px;
    padding: 12px;
    border-radius: 15px;
  }

  .profile-banner-preview {
    position: relative;
    display: grid;
    min-height: 116px;
    overflow: hidden;
    background: linear-gradient(125deg, color-mix(in srgb, var(--sui-primary, #5b54e0) 84%, #18233b), color-mix(in srgb, var(--sui-primary, #5b54e0) 38%, #72b8c2));
    border-radius: 11px;
    box-shadow: var(--sui-shadow-raised-sm, 0 5px 12px rgb(39 51 67 / 17%));
    place-items: center;
  }

  .profile-banner-preview::after {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgb(11 21 44 / 3%), rgb(11 21 44 / 30%));
    content: '';
    pointer-events: none;
  }

  .profile-banner-preview img {
    width: 100%;
    height: 100%;
    min-height: 116px;
    object-fit: cover;
  }

  .profile-banner-preview--empty {
    background: radial-gradient(circle at 18% 15%, rgb(255 255 255 / 28%), transparent 24%), linear-gradient(125deg, color-mix(in srgb, var(--sui-primary, #5b54e0) 78%, #18233b), color-mix(in srgb, var(--sui-primary, #5b54e0) 32%, #72b8c2));
  }

  .banner-placeholder {
    position: absolute;
    z-index: 1;
    display: flex;
    align-items: flex-end;
    gap: 5px;
    bottom: 20px;
    left: 22px;
    height: 32px;
  }

  .banner-placeholder i {
    display: block;
    width: 9px;
    height: 17px;
    background: rgb(255 255 255 / 58%);
    border-radius: 8px 8px 2px 2px;
    transform: rotate(-22deg);
  }

  .banner-placeholder i:nth-child(2) { height: 29px; transform: rotate(4deg); }
  .banner-placeholder i:nth-child(3) { height: 22px; transform: rotate(23deg); }

  .banner-placeholder-label {
    position: absolute;
    z-index: 1;
    right: 18px;
    bottom: 17px;
    color: rgb(255 255 255 / 82%);
    font-size: calc(8px * var(--text-scale));
    font-weight: 700;
    letter-spacing: .07em;
    text-transform: uppercase;
  }

  .profile-avatar-editor {
    margin-top: 13px;
    padding: 13px;
    border-radius: 14px;
  }

  .profile-avatar-preview {
    display: grid;
    width: 62px;
    height: 62px;
    flex: none;
    overflow: hidden;
    color: #fff;
    background: linear-gradient(145deg, var(--sui-primary, #5b54e0), color-mix(in srgb, var(--sui-primary, #5b54e0) 62%, #25314d));
    border-radius: 19px;
    box-shadow: var(--sui-shadow-raised-sm, 0 5px 12px rgb(39 51 67 / 17%));
    font-size: calc(21px * var(--text-scale));
    font-weight: 720;
    place-items: center;
  }

  .profile-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }

  .profile-media-copy { min-width: 0; }
  .profile-media-copy strong { display: block; color: var(--sui-text, #2d3748); font-size: calc(10px * var(--text-scale)); }
  .profile-media-copy p { margin-top: 3px; color: var(--sui-text-light, #6a7d94); font-size: calc(8px * var(--text-scale)); line-height: 1.4; }

  .media-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }

  .media-button,
  .media-remove {
    min-height: 29px;
    padding: 0 10px;
    border: 0;
    border-radius: 9px;
    box-shadow: var(--sui-shadow-raised-sm, 0 4px 10px rgb(39 51 67 / 17%));
    cursor: pointer;
    font: inherit;
    font-size: calc(8px * var(--text-scale));
    font-weight: 690;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .media-button { color: var(--sui-primary, #5b54e0); background: var(--sui-bg, #e4e9f0); }
  .media-remove { color: var(--sui-danger, #c95667); background: var(--sui-bg, #e4e9f0); }
  .media-button:hover:not(:disabled), .media-remove:hover:not(:disabled) { transform: translateY(-1px); }
  .media-button:active:not(:disabled), .media-remove:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 17%)); transform: translateY(1px); }
  .media-button:disabled, .media-remove:disabled { cursor: default; opacity: .55; }

  .profile-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 13px; }
  .dialog-field { min-width: 0; }
  .dialog-field label, .accent-picker legend { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .field-optional { color: var(--sui-text-light, #6a7d94); font-size: calc(7px * var(--text-scale)); font-weight: 600; }
  .dialog-field p { color: var(--sui-text-light, #6a7d94); font-size: calc(8px * var(--text-scale)); text-align: right; }
  .dialog-field textarea { width: 100%; resize: vertical; }

  .accent-picker {
    min-width: 0;
    margin: 15px 0 0;
    padding: 0;
    border: 0;
  }

  .accent-picker legend { width: 100%; padding: 0; color: var(--sui-text, #2d3748); font-size: calc(10px * var(--text-scale)); font-weight: 680; }
  .accent-options { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; margin-top: 8px; }
  .accent-option { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; min-height: 31px; padding: 0 6px; color: var(--sui-text-muted, #5a6a7e); background: var(--sui-bg, #e4e9f0); border: 0; border-radius: 9px; box-shadow: var(--sui-shadow-raised-sm, 0 4px 10px rgb(39 51 67 / 17%)); cursor: pointer; font: inherit; font-size: calc(7px * var(--text-scale)); font-weight: 670; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .accent-option:hover { color: var(--sui-text, #2d3748); transform: translateY(-1px); }
  .accent-option--active { color: var(--sui-primary, #5b54e0); box-shadow: var(--sui-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 17%)); }
  .accent-swatch { width: 10px; height: 10px; flex: none; background: var(--accent-swatch, linear-gradient(145deg, #7c83a3, #c8d0dc)); border-radius: 50%; box-shadow: inset 1px 1px 2px rgb(255 255 255 / 36%); }
  .accent-option--default .accent-swatch { background: linear-gradient(135deg, #5b54e0 0 50%, #2a9a78 50% 100%); }
  .hidden-file { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }

  @media (max-width: 620px) {
    .profile-field-grid { grid-template-columns: 1fr; }
    .accent-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .accent-option--default { grid-column: 1 / -1; }
  }
</style>
