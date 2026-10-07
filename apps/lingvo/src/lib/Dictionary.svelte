<script lang="ts">
  // Searches and organises personal cards with paginated queries and revision-safe actions
  import { onDestroy } from 'svelte';
  import { createQuery, keepPreviousData } from '@tanstack/svelte-query';
  import { lingvoCardsOptions } from '@kaordo/api-client';
  import type { LingvoCard, LingvoDictionary, LingvoFolder } from '@kaordo/contracts';
  import { cardContent } from '@kaordo/lingvo-client';
  import {
    AlertDialog, Button, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, Dialog, DropdownMenu,
    EllipsisIcon, FolderPlusIcon, Input, LoaderCircleIcon, PencilIcon, SearchIcon, SparklesIcon, ToggleGroup, Trash2Icon
  } from '@kaordo/ui';
  import { dueDate, errorMessage, getLingvoContext, type CardKind } from './lingvo-context';
  import CardDefinition from './CardDefinition.svelte';
  import FolderPicker from './FolderPicker.svelte';

  let { dictionary, folders, kind, folder, onEdit, onFilter, onStudy }:
    { dictionary: LingvoDictionary; folders: LingvoFolder[]; kind: CardKind; folder: string;
      onEdit(card: LingvoCard): void; onFilter(kind: CardKind, folder: string): void; onStudy(): void } = $props();
  const { api, queryClient, changed, notify } = getLingvoContext();
  let searchInput = $state('');
  let search = $state('');
  let status = $state('all');
  let offset = $state(0);
  let pending = $state<string[]>([]);
  const busy = $derived(pending.length > 0);
  let error = $state('');
  let foldersOpen = $state(false);
  let folderName = $state('');
  let confirm = $state<{ card: LingvoCard } | { folder: LingvoFolder } | null>(null);
  let disposed = false;
  const abort = new AbortController();
  const id = $props.id();
  const limit = 30;
  const options = $derived({ kind, folder: folder || undefined, q: search || undefined,
    status: status === 'all' ? undefined : status as LingvoCard['status'], offset, limit });
  const cards = createQuery(() => ({ ...lingvoCardsOptions(api, dictionary.id, options), placeholderData: keepPreviousData }), () => queryClient);
  const statuses = [{ value: 'all', label: 'All cards' }, { value: 'active', label: 'Learning' }, { value: 'known', label: 'Already known' }, { value: 'suspended', label: 'Paused' }];

  $effect(() => {
    const value = searchInput.trim();
    const timer = setTimeout(() => { search = value; offset = 0; }, 200);
    return () => clearTimeout(timer);
  });
  $effect(() => { kind; folder; status; offset = 0; });
  $effect(() => {
    if (cards.data && !cards.isPlaceholderData && offset > 0 && offset >= cards.data.total) {
      offset = Math.max(0, Math.floor((cards.data.total - 1) / limit) * limit);
    }
  });
  onDestroy(() => { disposed = true; abort.abort(); });

  async function perform(action: () => Promise<unknown>, message: string, finish?: () => void, key = 'folder:create'): Promise<void> {
    if (pending.includes(key)) return;
    pending = [...pending, key];
    error = '';
    try {
      await action();
      if (disposed) return;
      finish?.();
      void changed(dictionary.id);
      notify(message);
    } catch (cause) { if (!disposed) error = errorMessage(cause); }
    finally { if (!disposed) pending = pending.filter(item => item !== key); }
  }

  function setStatus(card: LingvoCard, next: LingvoCard['status']): void {
    void perform(() => api.updateCard(dictionary.id, card.id, { ...cardContent(card), status: next, revision: card.revision }, abort.signal),
      next === 'known' ? 'Card marked as known.' : next === 'suspended' ? 'Card paused.' : 'Card returned to practice.', undefined, card.id);
  }

  function remove(): void {
    if (!confirm) return;
    if ('card' in confirm) {
      const card = confirm.card;
      void perform(() => api.deleteCard(dictionary.id, card.id, card.revision, abort.signal), 'Card deleted.', () => { confirm = null; }, card.id);
    } else {
      const selected = confirm.folder;
      void perform(() => api.deleteFolder(dictionary.id, selected.id, abort.signal), 'Folder deleted. Its cards are now unfiled.', () => {
        confirm = null;
        if (folder === selected.id) onFilter(kind, '');
      }, selected.id);
    }
  }

  function addFolder(event: SubmitEvent): void {
    event.preventDefault();
    const name = folderName.trim();
    if (name) void perform(() => api.createFolder(dictionary.id, name, abort.signal), 'Folder created.', () => { folderName = ''; });
  }
</script>

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
  <div><p class="lingvo-eyebrow">Made for you, by you</p><h1 class="mt-2 text-3xl font-bold tracking-tight">My dictionary</h1><p class="mt-2 text-sm text-muted-foreground">Keep your German close. Shape each card into something you remember.</p></div>
  <Button variant="outline" onclick={onStudy}><SparklesIcon class="size-4" />Practice these cards</Button>
</div>
<div class="lingvo-surface p-4 sm:p-5">
  <div class="flex flex-wrap items-center gap-3">
    <div class="relative min-w-44 flex-1"><SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input class="pl-9" bind:value={searchInput} maxlength={100} aria-label="Search your dictionary" placeholder="Find a word, phrase or translation…" /></div>
    <ToggleGroup.Root type="single" value={kind} onValueChange={(value) => { if (value === 'word' || value === 'phrase') onFilter(value, folder); }} variant="outline" aria-label="Dictionary card type"><ToggleGroup.Item value="word">Words</ToggleGroup.Item><ToggleGroup.Item value="phrase">Phrases</ToggleGroup.Item></ToggleGroup.Root>
  </div>
  <div class="mt-3 flex flex-wrap items-center gap-2">
    <FolderPicker {folders} value={folder} onValueChange={(value) => onFilter(kind, value)} emptyLabel="All folders" includeUnfiled />
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>{#snippet child({ props })}<Button {...props} variant="outline" size="sm">{statuses.find(item => item.value === status)?.label}<ChevronDownIcon class="size-3.5" /></Button>{/snippet}</DropdownMenu.Trigger>
      <DropdownMenu.Content><DropdownMenu.RadioGroup bind:value={status}>{#each statuses as item}<DropdownMenu.RadioItem value={item.value}>{item.label}</DropdownMenu.RadioItem>{/each}</DropdownMenu.RadioGroup></DropdownMenu.Content>
    </DropdownMenu.Root>
    <Button variant="ghost" size="sm" onclick={() => { error = ''; foldersOpen = true; }}><FolderPlusIcon class="size-4" />Manage folders</Button>
  </div>
</div>
<div class="my-3 flex min-h-5 items-center justify-between text-xs text-muted-foreground" role="status"><span>{cards.data?.total ?? 0} {kind}{cards.data?.total === 1 ? '' : 's'}</span>{#if cards.isFetching}<span class="inline-flex items-center gap-1.5"><LoaderCircleIcon class="size-3 motion-safe:animate-spin" />Updating…</span>{/if}</div>
{#if error && !foldersOpen && !confirm}<p class="mb-3 text-sm text-destructive" role="alert">{error}</p>{/if}
{#if cards.isError}
  <div class="lingvo-surface p-6"><p role="alert" class="text-sm text-destructive">{errorMessage(cards.error)}</p><Button class="mt-4" variant="outline" onclick={() => void cards.refetch()}>Try again</Button></div>
{:else if cards.isPending}
  <div class="lingvo-surface py-20 text-center text-muted-foreground" role="status">Opening your dictionary…</div>
{:else if !cards.data?.items.length}
  <div class="lingvo-surface px-6 py-20 text-center"><h2 class="text-lg font-semibold">{search ? 'No cards match your search.' : 'A little room for new words.'}</h2><p class="mt-2 text-sm text-muted-foreground">{search ? 'Try a different term or translation.' : 'Add your own cards or choose a starter set from the library.'}</p></div>
{:else}
  <div class="overflow-hidden rounded-3xl border border-border bg-card">
    {#each cards.data.items as card (card.id)}
      <article class="border-b border-border p-5 last:border-b-0 sm:p-6">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1"><p class="text-lg font-semibold leading-7" lang="de">{#if card.article}<span class="german-article mr-1.5" data-article={card.article}>{card.article}</span>{/if}{card.term}</p><p class="mt-1 text-sm leading-6 text-muted-foreground" lang={dictionary.nativeLanguage}>{card.translation}</p></div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>{#snippet child({ props })}<Button {...props} disabled={pending.includes(card.id) || cards.isPlaceholderData} variant="ghost" size="icon-sm" aria-label={'Actions for ' + card.term}><EllipsisIcon /></Button>{/snippet}</DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onSelect={() => onEdit(card)}><PencilIcon />Edit card</DropdownMenu.Item>
              {#if card.status !== 'known'}<DropdownMenu.Item onSelect={() => setStatus(card, 'known')}>I already know this</DropdownMenu.Item>{/if}
              {#if card.status !== 'active'}<DropdownMenu.Item onSelect={() => setStatus(card, 'active')}>Return to practice</DropdownMenu.Item>{/if}
              {#if card.status === 'active'}<DropdownMenu.Item onSelect={() => setStatus(card, 'suspended')}>Pause this card</DropdownMenu.Item>{/if}
              <DropdownMenu.Separator /><DropdownMenu.Item variant="destructive" onSelect={() => { error = ''; confirm = { card }; }}><Trash2Icon />Delete card</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span class="rounded-lg bg-muted px-2 py-1">{card.status === 'known' ? 'Known' : card.status === 'suspended' ? 'Paused' : card.schedule.state === 0 ? 'New' : 'Learning'}</span>
          {#if card.folderId}<span>{folders.find(item => item.id === card.folderId)?.name ?? 'Unfiled'}</span>{/if}
          {#if card.status === 'active' && card.schedule.reps}<span>Next review: {dueDate(card.schedule.due)}</span>{/if}
        </div>
        {#if card.plural || card.grammar || card.example || card.notes}
          <details class="mt-3"><summary class="min-h-8 w-fit cursor-pointer content-center rounded-lg py-1 text-xs font-semibold text-link focus-visible:outline-2 focus-visible:outline-ring">Grammar & context</summary><div class="mt-3 rounded-xl bg-muted/25 p-4"><CardDefinition {card} compact showTerm={false} showTranslation={false} nativeLanguage={dictionary.nativeLanguage} /></div></details>
        {/if}
      </article>
    {/each}
  </div>
  {#if cards.data.total > limit}
    <div class="mt-5 flex items-center justify-center gap-3"><Button variant="outline" size="sm" disabled={!offset || cards.isPlaceholderData} onclick={() => { offset = Math.max(0, offset - limit); }}><ChevronLeftIcon />Previous</Button><span class="text-sm text-muted-foreground">{Math.floor(offset / limit) + 1} / {Math.ceil(cards.data.total / limit)}</span><Button variant="outline" size="sm" disabled={offset + limit >= cards.data.total || cards.isPlaceholderData} onclick={() => { offset += limit; }}>Next<ChevronRightIcon /></Button></div>
  {/if}
{/if}

<Dialog.Root bind:open={foldersOpen}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header><Dialog.Title>Your folders</Dialog.Title><Dialog.Description>Keep related words and phrases together. Deleting a folder keeps its cards.</Dialog.Description></Dialog.Header>
    <form onsubmit={addFolder} class="flex items-end gap-2"><div class="flex-1"><label for={`${id}-folder`} class="mb-2 block text-sm font-semibold">New folder</label><Input id={`${id}-folder`} bind:value={folderName} required maxlength={60} placeholder="e.g. My next trip" /></div><Button type="submit" disabled={busy || !folderName.trim()}><FolderPlusIcon />Add</Button></form>
    <ul class="max-h-64 space-y-2 overflow-y-auto">{#each folders as item (item.id)}<li class="flex items-center justify-between rounded-xl border border-border px-4 py-2"><span class="text-sm font-medium">{item.name}</span><Button variant="ghost" size="icon-sm" aria-label={'Delete folder ' + item.name} disabled={busy} onclick={() => { error = ''; confirm = { folder: item }; }}><Trash2Icon class="size-4 text-destructive" /></Button></li>{/each}</ul>
    {#if !folders.length}<p class="text-sm text-muted-foreground">No folders yet. All your cards are unfiled.</p>{/if}
    {#if error && !confirm}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
  </Dialog.Content>
</Dialog.Root>
<AlertDialog.Root open={!!confirm} onOpenChange={(value) => { if (!value) confirm = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header><AlertDialog.Title>Delete {confirm && 'card' in confirm ? 'this card' : 'this folder'}?</AlertDialog.Title><AlertDialog.Description>{confirm && 'card' in confirm ? 'The card and its learning schedule will be removed. Your past review totals will be kept.' : 'The folder will be removed. Its cards will stay in your dictionary as unfiled cards.'}</AlertDialog.Description></AlertDialog.Header>
    {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
    <AlertDialog.Footer><AlertDialog.Cancel disabled={busy}>Cancel</AlertDialog.Cancel><Button variant="destructive" disabled={busy} onclick={remove}>{#if busy}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{/if}Delete {confirm && 'card' in confirm ? 'card' : 'folder'}</Button></AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
