// Owns a profile draft, local crop previews and the existing resumable upload workflow

import { onDestroy } from 'svelte';
import type { QueryClient } from '@tanstack/svelte-query';
import { fluoProfileKeys, invalidateFluoPostQueries, updateFluoProfileCache, type FluoApi } from '@kaordo/api-client';
import type { FluoProfile, FluoProfileUpdate } from '@kaordo/contracts';
import { isSupportedImageType, MAX_IMAGE_SIZE, prepareImage, uploadMedia } from '@kaordo/media-client';
import { errorMessage } from './fluo-model';

export type ProfileImageSlot = 'avatar' | 'banner';
export const profileImageSizes = {
  avatar: { aspectRatio: 1, width: 512, height: 512, title: 'Crop your avatar' },
  banner: { aspectRatio: 3, width: 1500, height: 500, title: 'Crop your banner' }
} as const;

export function createFluoProfileEditor(
  profile: FluoProfile, api: Pick<FluoApi, 'updateProfile' | 'uploadMetadata'>,
  queryClient: QueryClient, nodoBaseUrl: string, onSaved: () => void
) {
  const lifetime = new AbortController();
  const draft = $state({
    nickname: profile.displayName, bio: profile.bio, birthDate: profile.birthDate ?? '',
    location: profile.location, website: profile.website, pronouns: profile.pronouns
  });
  const images = $state<Record<ProfileImageSlot, { id: string | null; url: string; file: File | null }>>({
    avatar: { id: profile.avatar?.id ?? null, url: profile.avatar?.url ?? '', file: null },
    banner: { id: profile.banner?.id ?? null, url: profile.banner?.url ?? '', file: null }
  });
  let crop = $state.raw<{ slot: ProfileImageSlot; file: File } | null>(null);
  let preparing = $state(false);
  let saving = $state(false);
  let progress = $state(0);
  let error = $state('');

  function releasePreview(slot: ProfileImageSlot) {
    if (images[slot].file) URL.revokeObjectURL(images[slot].url);
  }
  onDestroy(() => {
    lifetime.abort();
    releasePreview('avatar');
    releasePreview('banner');
  });

  async function chooseImage(slot: ProfileImageSlot, file: File) {
    if (preparing || saving || lifetime.signal.aborted) return;
    preparing = true;
    error = '';
    try {
      if (!isSupportedImageType(file.type) || file.size > MAX_IMAGE_SIZE || file.size === 0) {
        throw new Error('Choose a JPEG, PNG or WebP image up to 20 MiB.');
      }
      const prepared = await prepareImage(file);
      if (!lifetime.signal.aborted) crop = { slot, file: prepared };
    } catch (cause) {
      if (!lifetime.signal.aborted) error = errorMessage(cause, 'Could not open this image.');
    } finally {
      if (!lifetime.signal.aborted) preparing = false;
    }
  }

  function applyCrop(file: File) {
    if (!crop || lifetime.signal.aborted) return;
    const slot = crop.slot;
    releasePreview(slot);
    images[slot] = { id: null, url: URL.createObjectURL(file), file };
    crop = null;
  }

  function removeImage(slot: ProfileImageSlot) {
    releasePreview(slot);
    images[slot] = { id: null, url: '', file: null };
  }

  async function uploadImages() {
    const uploads = (['avatar', 'banner'] as const).flatMap((slot) => {
      const image = images[slot];
      return image.file && !image.id ? [{ slot, file: image.file }] : [];
    });
    const ids = await uploadMedia(uploads.map(({ file }) => file), nodoBaseUrl, api,
      (percent) => { if (!lifetime.signal.aborted) progress = percent; },
      { maxFiles: 2, signal: lifetime.signal });
    lifetime.signal.throwIfAborted();
    uploads.forEach(({ slot }, index) => { images[slot].id = ids[index]; });
  }

  async function save() {
    if (saving || preparing || crop || lifetime.signal.aborted) return;
    saving = true;
    progress = 0;
    error = '';
    try {
      await uploadImages();
      const input: FluoProfileUpdate = {
        ...draft, nickname: draft.nickname.trim(), birthDate: draft.birthDate || null,
        avatarId: images.avatar.id, bannerId: images.banner.id
      };
      const saved = await api.updateProfile(input, lifetime.signal);
      lifetime.signal.throwIfAborted();
      await updateFluoProfileCache(queryClient, saved, lifetime.signal);
      lifetime.signal.throwIfAborted();
      await Promise.all([
        invalidateFluoPostQueries(queryClient, { notifications: true }),
        queryClient.invalidateQueries({ queryKey: fluoProfileKeys.connections })
      ]);
      if (!lifetime.signal.aborted) onSaved();
    } catch (cause) {
      if (!lifetime.signal.aborted) error = errorMessage(cause, 'Could not save your profile.');
    } finally {
      if (!lifetime.signal.aborted) saving = false;
    }
  }

  return {
    draft, images, chooseImage, applyCrop, removeImage, save,
    cancelCrop() { crop = null; },
    get crop() { return crop; }, get preparing() { return preparing; },
    get saving() { return saving; }, get progress() { return progress; }, get error() { return error; }
  };
}
