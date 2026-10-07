// Shares authenticated requests and the workspace-owned query cache with Lingvo views
import { createContext } from 'svelte';
import type { QueryClient } from '@tanstack/svelte-query';
import type { LingvoApi } from '@kaordo/api-client';

export const [getLingvoContext, setLingvoContext] = createContext<{
  api: LingvoApi;
  queryClient: QueryClient;
  notify(message: string): void;
  changed(dictionaryId: string): Promise<void>;
}>();

export type LingvoView = 'learn' | 'phrases' | 'dictionary' | 'library' | 'study';
export type CardKind = 'word' | 'phrase';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function dueDate(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
