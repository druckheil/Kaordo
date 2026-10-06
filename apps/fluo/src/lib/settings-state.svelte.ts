// Projects pending preference changes over confirmed Fluo settings while TanStack serializes saves

import { onDestroy } from 'svelte';
import { createMutation, createQuery, useMutationState, type Mutation, type QueryClient } from '@tanstack/svelte-query';
import { fluoSettingsKey, fluoSettingsOptions, invalidateFluoPostQueries, type FluoApi } from '@kaordo/api-client';
import type {
  FluoNotificationPolicy, FluoNotificationPreferences, FluoPrivacySettings, FluoSettings, FluoSettingsPatch
} from '@kaordo/contracts';

export type FluoSettingChange =
  | { field: keyof FluoNotificationPreferences; value: FluoNotificationPolicy }
  | { field: 'accountVisibility'; value: FluoPrivacySettings['accountVisibility'] }
  | { field: 'showLikes'; value: FluoPrivacySettings['showLikes'] };

function settingsPatch(change: FluoSettingChange): FluoSettingsPatch {
  switch (change.field) {
    case 'accountVisibility': return { privacy: { accountVisibility: change.value } };
    case 'showLikes': return { privacy: { showLikes: change.value } };
    default: return { notifications: { [change.field]: change.value } };
  }
}

export function createFluoSettingsState(api: FluoApi, queryClient: QueryClient, active: () => boolean) {
  const lifetime = new AbortController();
  onDestroy(() => lifetime.abort());
  const enabled = $derived(typeof window !== 'undefined' && active());
  const query = createQuery(() => ({ ...fluoSettingsOptions(api), enabled }), () => queryClient);
  const changes = useMutationState({
    filters: { mutationKey: fluoSettingsKey, exact: true },
    select: (mutation: Mutation<FluoSettings, Error, FluoSettingChange>) => ({
      id: mutation.mutationId, change: mutation.state.variables,
      status: mutation.state.status, error: mutation.state.error
    })
  }, queryClient);
  const pending = $derived(changes.filter((change) => change.status === 'pending'));
  const settings = $derived.by(() => {
    if (!query.data) return undefined;
    // Mutation notifications can precede the query observer; the cache already holds the confirmed response.
    const confirmed = queryClient.getQueryData<FluoSettings>(fluoSettingsKey) ?? query.data;
    // Later pending choices remain visible when an earlier request confirms its own snapshot.
    return pending.reduce<FluoSettings>((current, mutation) => {
      if (!mutation.change) return current;
      const patch = settingsPatch(mutation.change);
      return {
        notifications: { ...current.notifications, ...patch.notifications },
        privacy: { ...current.privacy, ...patch.privacy }
      };
    }, confirmed);
  });
  const failures = $derived.by(() => {
    const latest = new Map<FluoSettingChange['field'], typeof changes[number]>();
    for (const mutation of changes) {
      if (mutation.change) latest.set(mutation.change.field, mutation);
    }
    // A newer choice for the same field supersedes its earlier failure; unrelated failures stay visible.
    return [...latest.values()].flatMap(({ id, change, status, error }) =>
      change && status === 'error' ? [{ id, change, error }] : []);
  });

  $effect(() => {
    if (!enabled) void queryClient.cancelQueries({ queryKey: fluoSettingsKey });
  });

  const save = createMutation(() => ({
    mutationKey: fluoSettingsKey,
    scope: { id: 'fluo-settings' },
    mutationFn: (change: FluoSettingChange) => api.updateSettings(settingsPatch(change), lifetime.signal),
    onMutate: () => queryClient.cancelQueries({ queryKey: fluoSettingsKey }),
    onSuccess: async (settings, change) => {
      await queryClient.cancelQueries({ queryKey: fluoSettingsKey });
      if (lifetime.signal.aborted) return;
      queryClient.setQueryData(fluoSettingsKey, settings);
      if (change.field === 'accountVisibility' || change.field === 'showLikes') {
        // Previously loaded content and notification previews must obey the saved privacy policy.
        await invalidateFluoPostQueries(queryClient, { notifications: true });
      }
    },
    onError: () => {
      if (lifetime.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: fluoSettingsKey });
    }
  }), () => queryClient);

  return {
    query, save,
    get settings() { return settings; },
    get isSaving() { return pending.length > 0; },
    get failures() { return failures; }
  };
}

export type FluoSettingsState = ReturnType<typeof createFluoSettingsState>;
