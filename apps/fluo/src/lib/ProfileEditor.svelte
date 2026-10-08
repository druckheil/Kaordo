<script lang="ts">
  // Presents a compact profile form with local image cropping and optional personal details

  import { untrack } from 'svelte';
  import type { QueryClient } from '@tanstack/svelte-query';
  import type { FluoApi } from '@kaordo/api-client';
  import type { FluoProfile } from '@kaordo/contracts';
  import { ImageCropDialog } from '@kaordo/media-ui';
  import { Button, Input, Textarea, CameraIcon, XIcon, LoaderCircleIcon, CheckIcon } from '@kaordo/ui';
  import { UserAvatar } from '@kaordo/account-ui';
  import { createFluoProfileEditor, profileImageSizes, type ProfileImageSlot } from './profile-editor-state.svelte.ts';

  let { profile, api, queryClient, onCancel, onSaved }: {
    profile: FluoProfile;
    api: FluoApi;
    queryClient: QueryClient;
    onCancel: () => void;
    onSaved: () => void;
  } = $props();

  const id = $props.id();
  const state = createFluoProfileEditor(untrack(() => profile), untrack(() => api), untrack(() => queryClient),
    import.meta.env.VITE_KAORDO_NODO_URL, () => onSaved());
  let avatarInput: HTMLInputElement;
  let bannerInput: HTMLInputElement;
  const avatarPreview = $derived({
    id: profile.id,
    displayName: state.draft.nickname,
    avatar: state.images.avatar.url ? { url: state.images.avatar.url } : null
  });
  const busy = $derived(state.saving || state.preparing);
  const today = new Date().toISOString().slice(0, 10);

  function chooseImage(event: Event, slot: ProfileImageSlot) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void state.chooseImage(slot, file);
  }
</script>

<form class="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm" onsubmit={(event) => { event.preventDefault(); void state.save(); }} aria-label="Edit Fluo profile" aria-busy={busy}>
  <div class="relative aspect-[3/1] bg-gradient-to-br from-primary/15 via-accent to-muted">
    {#if state.images.banner.url}<img src={state.images.banner.url} alt="Banner preview" class="absolute inset-0 h-full w-full object-cover" />{/if}
    <div class="absolute right-3 top-3 flex gap-1.5">
      <Button type="button" variant="secondary" size="sm" class="shadow-sm" disabled={busy} onclick={() => bannerInput.click()}><CameraIcon class="size-4" />{state.images.banner.url ? 'Change banner' : 'Add banner'}</Button>
      {#if state.images.banner.url}<Button type="button" variant="secondary" size="icon-sm" disabled={busy} aria-label="Remove banner" onclick={() => state.removeImage('banner')}><XIcon class="size-4" /></Button>{/if}
    </div>
  </div>
  <input bind:this={avatarInput} class="hidden" type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => chooseImage(event, 'avatar')} aria-label="Choose avatar image" />
  <input bind:this={bannerInput} class="hidden" type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => chooseImage(event, 'banner')} aria-label="Choose banner image" />

  <div class="px-5 pb-5 sm:px-6 sm:pb-6">
    <div class="relative -mt-10 mb-5 flex flex-wrap items-end gap-3">
      <div class="relative rounded-3xl border-4 border-card bg-card">
        <UserAvatar user={avatarPreview} image={avatarPreview.avatar} class="size-24 rounded-[1.25rem] [&_[data-slot=avatar-fallback]]:text-3xl" />
        <Button type="button" variant="secondary" size="icon-sm" class="absolute -bottom-2 -right-2 rounded-full border border-border shadow-sm" aria-label={state.images.avatar.url ? 'Change avatar' : 'Add avatar'} disabled={busy} onclick={() => avatarInput.click()}><CameraIcon class="size-4" /></Button>
      </div>
      <div class="flex min-h-10 items-center gap-2 pb-1">
        <p class="text-xs text-muted-foreground">JPEG, PNG or WebP · up to 20 MiB</p>
        {#if state.images.avatar.url}<Button type="button" variant="ghost" size="icon-xs" disabled={busy} aria-label="Remove avatar" onclick={() => state.removeImage('avatar')}><XIcon class="size-3.5" /></Button>{/if}
      </div>
    </div>
    <div class="mb-5 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold tracking-tight">Edit profile</h1>
      {#if state.preparing}<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><LoaderCircleIcon class="size-3.5 motion-safe:animate-spin" />Preparing image…</span>{/if}
    </div>
    <fieldset disabled={state.saving} class="grid min-w-0 gap-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <label for={`${id}-nickname`} class="text-sm font-medium">Nickname</label>
          <Input id={`${id}-nickname`} bind:value={state.draft.nickname} required maxlength={80} autocomplete="nickname" />
        </div>
        <div class="grid gap-1.5">
          <label for={`${id}-username`} class="text-sm font-medium">Username</label>
          <Input id={`${id}-username`} value={`@${profile.username}`} readonly class="bg-muted/50 text-muted-foreground" aria-describedby={`${id}-username-help`} />
          <p id={`${id}-username-help`} class="text-xs text-muted-foreground">Your unique Kaordo account name.</p>
        </div>
      </div>
      <div class="grid gap-1.5">
        <div class="flex items-center justify-between gap-3">
          <label for={`${id}-bio`} class="text-sm font-medium">Bio <span class="font-normal text-muted-foreground">· optional</span></label>
          <span class="text-xs tabular-nums text-muted-foreground">{Array.from(state.draft.bio).length}/500</span>
        </div>
        <Textarea id={`${id}-bio`} bind:value={state.draft.bio} maxlength={500} rows={3} class="min-h-24 resize-y" placeholder="A little about you" />
      </div>
      <div class="grid gap-x-4 gap-y-4 border-t border-border pt-4 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <label for={`${id}-birth-date`} class="text-sm font-medium">Birth date <span class="font-normal text-muted-foreground">· optional</span></label>
          <Input id={`${id}-birth-date`} type="date" bind:value={state.draft.birthDate} min="1900-01-01" max={today} autocomplete="bday" />
        </div>
        <div class="grid gap-1.5">
          <label for={`${id}-location`} class="text-sm font-medium">Location <span class="font-normal text-muted-foreground">· optional</span></label>
          <Input id={`${id}-location`} bind:value={state.draft.location} maxlength={100} placeholder="City, country or somewhere else" />
        </div>
        <div class="grid gap-1.5">
          <label for={`${id}-website`} class="text-sm font-medium">Website <span class="font-normal text-muted-foreground">· optional</span></label>
          <Input id={`${id}-website`} type="url" bind:value={state.draft.website} maxlength={300} placeholder="https://" autocomplete="url" />
        </div>
        <div class="grid gap-1.5">
          <label for={`${id}-pronouns`} class="text-sm font-medium">Pronouns <span class="font-normal text-muted-foreground">· optional</span></label>
          <Input id={`${id}-pronouns`} bind:value={state.draft.pronouns} maxlength={40} placeholder="e.g. she/her" />
        </div>
      </div>
      <p class="text-xs leading-5 text-muted-foreground">Only filled details appear on your profile. Your registration date and verification are managed by Kaordo.</p>
    </fieldset>
    {#if state.error}<p class="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{state.error}</p>{/if}
    <div class="mt-5 flex justify-end gap-2 border-t border-border pt-4">
      <Button type="button" variant="outline" disabled={state.saving} onclick={onCancel}>Cancel</Button>
      <Button type="submit" class="min-w-32" disabled={busy || !state.draft.nickname.trim()}>
        {#if state.saving}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{:else}<CheckIcon class="size-4" />{/if}
        {state.saving ? state.progress > 0 && state.progress < 100 ? `Uploading ${state.progress}%` : 'Saving…' : 'Save changes'}
      </Button>
    </div>
  </div>
</form>

{#if state.crop}
  {@const size = profileImageSizes[state.crop.slot]}
  <ImageCropDialog file={state.crop.file} title={size.title} aspectRatio={size.aspectRatio} outputWidth={size.width} outputHeight={size.height} onApply={state.applyCrop} onCancel={state.cancelCrop} />
{/if}
