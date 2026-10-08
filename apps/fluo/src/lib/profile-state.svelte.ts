// Owns profile queries and cancellable follow and status changes

import { onDestroy } from 'svelte';
import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { fluoProfileKeys, fluoProfileOptions, invalidateFluoFollowQueries, updateFluoProfileCache, type FluoApi } from '@kaordo/api-client';
import type { FluoProfile, FluoStatus } from '@kaordo/contracts';

export function createFluoProfileState(
  api: Pick<FluoApi, 'profile' | 'follow' | 'setStatus'>, queryClient: QueryClient, username: () => string
) {
  const lifetime = new AbortController();
  onDestroy(() => lifetime.abort());
  const query = createQuery(() => ({
    ...fluoProfileOptions(api, username()), enabled: typeof window !== 'undefined' && !!username()
  }), () => queryClient);
  const follow = createMutation(() => ({
    mutationFn: (profile: FluoProfile) => api.follow(profile.id, !profile.following, lifetime.signal),
    onSuccess: () => lifetime.signal.aborted ? undefined : invalidateFluoFollowQueries(queryClient)
  }), () => queryClient);
  const setStatus = createMutation(() => ({
    mutationFn: (status: FluoStatus) => api.setStatus(status, lifetime.signal),
    onMutate: () => queryClient.cancelQueries({ queryKey: fluoProfileKeys.profile(username()) }),
    onSuccess: (profile) => updateFluoProfileCache(queryClient, profile, lifetime.signal)
  }), () => queryClient);

  return { query, follow, setStatus };
}
