// Owns message queries, live synchronization and idempotent outgoing message workflows
import { createInfiniteQuery, type InfiniteData, type QueryClient } from '@tanstack/svelte-query';
import { appendSentMessage, replaceCachedMessage, ligoMessageOptions, type LigoApi } from '@kaordo/api-client';
import type { LigoMessage, LigoMessagePage, LigoReaction } from '@kaordo/contracts';
import { uploadMedia } from '@kaordo/media-client';
import type { PendingMessage } from './types.ts';

interface ConversationDependencies {
  api: Pick<LigoApi, 'listMessages' | 'subscribe' | 'send' | 'setReaction' | 'editMessage' | 'deleteMessage' | 'uploadMetadata'>;
  queryClient: QueryClient;
  nodoBaseUrl: string;
  selectedId: () => string | null;
  onHint?: (conversationId: string | null) => void;
  onChanged?: () => Promise<void>;
  sendFailureMessage?: string;
}

export function createConversationState({
  api, queryClient, nodoBaseUrl, selectedId, onHint, onChanged,
  sendFailureMessage = 'Could not send the message.'
}: ConversationDependencies) {
  let connected = $state(true);
  let liveUnavailable = $state(false);
  let pending = $state<PendingMessage[]>([]);
  let controller: AbortController | null = null;
  let disposed = false;
  const lifetime = new AbortController();
  const query = createInfiniteQuery(() => ({
    ...ligoMessageOptions(api, selectedId() ?? ''),
    ...(!connected ? { refetchInterval: 5000 } : {}),
    enabled: !!selectedId()
  }), () => queryClient);
  const messages = $derived(query.data?.pages.flatMap(page => page.items).reverse() ?? []);
  const activePending = $derived(pending.filter(item => item.conversationId === selectedId() &&
    !messages.some(message => message.clientId === item.clientId)));

  function connect(): void {
    if (disposed) return;
    controller?.abort();
    const attempt = new AbortController();
    controller = attempt;
    connected = false;
    liveUnavailable = false;
    void api.subscribe(attempt.signal, id => {
      if (attempt.signal.aborted) return;
      onHint?.(id);
      if (!id || id === selectedId()) {
        void queryClient.invalidateQueries({ queryKey: ['ligo', 'messages', selectedId()] });
      }
    }, value => {
      if (!attempt.signal.aborted) connected = value;
    }).catch(() => {
      if (!attempt.signal.aborted) liveUnavailable = true;
    });
  }

  function updatePending(item: PendingMessage, changes: Partial<PendingMessage>): void {
    if (disposed) return;
    Object.assign(item, changes);
    pending = pending.map(entry => entry.clientId === item.clientId ? { ...item } : entry);
  }

  async function deliver(item: PendingMessage): Promise<void> {
    if (disposed) return;
    updatePending(item, {
      status: item.files.length && !item.attachmentIds ? 'uploading' : 'sending',
      error: undefined
    });
    try {
      if (!item.attachmentIds && item.files.length) {
        item.attachmentIds = await uploadMedia(item.files, nodoBaseUrl, api,
          progress => updatePending(item, { progress }), { allowFiles: true, maxFiles: 8, signal: lifetime.signal });
      }
      if (disposed) return;
      updatePending(item, { status: 'sending' });
      const message = await api.send(item.conversationId, {
        clientId: item.clientId, text: item.text, attachmentIds: item.attachmentIds ?? []
      }, lifetime.signal);
      if (disposed) return;
      queryClient.setQueryData<InfiniteData<LigoMessagePage>>(
        ['ligo', 'messages', item.conversationId], previous => appendSentMessage(previous, message));
      pending = pending.filter(entry => entry.clientId !== item.clientId);
      void onChanged?.();
    } catch (cause) {
      updatePending(item, { status: 'failed', error: cause instanceof Error ? cause.message : sendFailureMessage });
    }
  }

  function send(conversationId: string, text: string, files: File[]): void {
    if (disposed || (!text.trim() && !files.length)) return;
    const item: PendingMessage = {
      clientId: crypto.randomUUID(), conversationId, text: text.trim(), files: [...files],
      progress: 0, status: files.length ? 'uploading' : 'sending', createdAt: new Date().toISOString()
    };
    pending = [...pending, item];
    void deliver(item);
  }

  function replaceMessage(message: LigoMessage): void {
    if (disposed) return;
    queryClient.setQueryData<InfiniteData<LigoMessagePage>>(
      ['ligo', 'messages', message.conversationId], previous => replaceCachedMessage(previous, message));
  }

  async function react(message: LigoMessage, emoji: LigoReaction['emoji']): Promise<void> {
    const current = message.reactions.find(reaction => reaction.emoji === emoji);
    replaceMessage(await api.setReaction(message.conversationId, message.id, emoji, !current?.mine, lifetime.signal));
  }

  async function edit(message: LigoMessage, text: string): Promise<void> {
    replaceMessage(await api.editMessage(message.conversationId, message.id, text, lifetime.signal));
    if (!disposed) void onChanged?.();
  }

  async function remove(message: LigoMessage): Promise<void> {
    await api.deleteMessage(message.conversationId, message.id, lifetime.signal);
    if (disposed) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ligo', 'messages', message.conversationId] }),
      onChanged?.()
    ]);
  }

  return {
    query,
    get messages() { return messages; },
    get activePending() { return activePending; },
    get connected() { return connected; },
    get liveUnavailable() { return liveUnavailable; },
    connect, send, retry: deliver, react, edit, remove,
    dispose() { disposed = true; lifetime.abort(); controller?.abort(); pending = []; }
  };
}

export type ConversationState = ReturnType<typeof createConversationState>;
