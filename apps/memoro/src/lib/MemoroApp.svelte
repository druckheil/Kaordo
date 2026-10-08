<script lang="ts">
  // Presents the calendar, selected-day tasks and private journal without retaining plaintext in storage
  import { onMount, onDestroy, untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { getLocalTimeZone, today, parseDate } from '@internationalized/date';
  import type { UserIdentity } from '@kaordo/contracts';
  import { categories, emptyTask, type Task } from '@kaordo/memoro-client';
  import { RichText, type DraftAttachment } from '@kaordo/editor-ui';
  import { MediaGallery } from '@kaordo/media-ui';
  import { AppHeader, Button, AlertDialog, Dialog, CalendarDaysIcon, PlusIcon, LockIcon, CheckIcon, PencilIcon, Trash2Icon, CircleIcon, BookOpenIcon } from '@kaordo/ui';
  import { appPaths } from '@kaordo/links';
  import DiaryCalendar from './DiaryCalendar.svelte';
  import EntryEditor from './EntryEditor.svelte';
  import TaskEditor from './TaskEditor.svelte';
  import { createMemoroState, clearDrafts } from './memoro-state.svelte';

  let { user }: { user: UserIdentity } = $props();
  const todayDate = today(getLocalTimeZone()).toString();
  function validDate(raw: string | null) { try { return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseDate(raw).toString() : todayDate; } catch { return todayDate; } }
  const date = $derived(validDate(page.url.searchParams.get('date')));
  const diary = createMemoroState(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL, todayDate);
  const dateLabel = $derived(new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parseDate(date).toDate(getLocalTimeZone())));
  const tasks = $derived([...diary.document.tasks].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')));
  let editor = $state<Task | null>(null);
  let taskFiles = $state<DraftAttachment[]>([]);
  let taskOpen = $state(false);
  let deleteId = $state<string | null>(null);
  let pendingNavigation = $state<{ url: string; external: boolean } | null>(null);
  let confirmedNavigation = false;
  let taskDiscardOpen = $state(false);
  let taskSnapshot = '';
  const taskDirty = $derived(taskOpen && (!!taskFiles.length || JSON.stringify(editor) !== taskSnapshot));
  let discardOpen = $state(false);
  let reloadOpen = $state(false);
  let mounted = $state(false);
  $effect(() => { const selectedDate = date; if (mounted) untrack(() => void diary.loadDate(selectedDate)); });
  onMount(() => {
    mounted = true; void diary.loadMonth(date.slice(0, 7));
    const preventLoss = (event: BeforeUnloadEvent) => { if (!confirmedNavigation && (diary.dirty || taskDirty)) event.preventDefault(); };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  });
  onDestroy(() => clearDrafts(taskFiles));
  beforeNavigate(({ cancel, to }) => {
    if (confirmedNavigation || !to || !diary.dirty && !taskDirty) return;
    if (to.url.href === page.url.href) return;
    cancel(); pendingNavigation = { url: to.url.href, external: to.route.id === null };
    if (taskDirty) taskDiscardOpen = true; else discardOpen = true;
  });

  async function navigate(next: string) {
    if (diary.saving || next === date) return;
    if (diary.dirty) { pendingNavigation = { url: `${appPaths.memoro}?date=${next}`, external: false }; discardOpen = true; return; }
    await openDate(next);
  }
  async function openDate(next: string) { await goto(`${appPaths.memoro}?date=${next}`, { noScroll: true, keepFocus: true }); }
  async function continueNavigation() {
    if (!pendingNavigation) return;
    const target = pendingNavigation; pendingNavigation = null; discardOpen = false;
    confirmedNavigation = true;
    try { if (target.external) window.location.assign(target.url); else await goto(target.url, { noScroll: true }); }
    finally { if (!target.external) confirmedNavigation = false; }
  }
  function openTask(task?: Task) { clearDrafts(taskFiles); taskFiles = []; editor = task ? structuredClone($state.snapshot(task)) : emptyTask(); taskSnapshot = JSON.stringify(editor); taskOpen = true; }
  function closeTask(force = false) { if (diary.saving) return; if (!force && taskDirty) { taskDiscardOpen = true; return; } taskOpen = false; editor = null; clearDrafts(taskFiles); taskFiles = []; }
  async function saveTask() { if (editor && await diary.save(editor, taskFiles)) closeTask(true); }
</script>

<AppHeader name="Memoro" homeHref={appPaths.portal} />
<main id="main-content" tabindex="-1" class="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
  <header class="mb-6 flex flex-wrap items-end justify-between gap-3 pt-6 sm:pt-8">
    <div><p class="memoro-eyebrow">Your days, in one place</p><h1 class="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Memoro</h1><p class="mt-2 text-sm text-muted-foreground">Make a plan. Keep a memory.</p></div>
    <div class="flex items-center gap-3"><span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LockIcon class="size-3.5" />Only your devices</span><Button variant="outline" size="sm" onclick={() => navigate(todayDate)}><CalendarDaysIcon class="size-4" />Today</Button></div>
  </header>
  {#if diary.error}<div role="alert" class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"><p>{diary.error}</p><Button variant="outline" size="sm" disabled={diary.saving} onclick={() => { if (diary.dirty) reloadOpen = true; else void diary.loadDate(date, true); }}>Reload day</Button></div>{/if}
  <div class="grid gap-5 lg:grid-cols-2">
    <DiaryCalendar {date} summaries={diary.summaries} busy={diary.monthLoading} onDate={navigate} onMonth={diary.loadMonth} />
    <section class="memoro-surface flex min-h-96 flex-col p-4 sm:p-6" aria-label="Tasks for selected date" aria-busy={diary.loading}>
      <header class="mb-5 flex items-start justify-between gap-3"><div><p class="text-xs font-medium text-muted-foreground">{dateLabel}</p><h2 class="mt-1 text-xl font-semibold tracking-tight">Your plans <span class="ml-1 text-sm font-normal text-muted-foreground">{tasks.length || ''}</span></h2></div><Button size="icon" variant="outline" aria-label="Add task" disabled={!diary.available || diary.loading || diary.saving} onclick={() => openTask()}><PlusIcon class="size-5" /></Button></header>
      {#if diary.loading}<p role="status" class="py-12 text-center text-sm text-muted-foreground">Opening this day…</p>
      {:else if !tasks.length}<div class="flex flex-1 flex-col items-center justify-center py-10 text-center"><div class="grid size-12 place-items-center rounded-2xl bg-muted"><CalendarDaysIcon class="size-6 text-muted-foreground" /></div><h3 class="mt-4 font-medium">A little room for anything</h3><p class="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">Add something you want to do, or leave this day open.</p><Button class="mt-5" size="sm" variant="outline" disabled={!diary.available || diary.saving} onclick={() => openTask()}><PlusIcon class="size-4" />Add your first task</Button></div>
      {:else}<ul class="kaordo-scrollbar max-h-[38rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
        {#each tasks as task (task.id)}
          {@const category = categories.find(category => category.id === task.category)!}
          <li class="memoro-enter rounded-2xl border border-border/70 bg-background p-4">
            <div class="flex items-start gap-3"><Button size="icon-sm" variant="ghost" class="mt-0.5 shrink-0 rounded-full" aria-label={task.status === 'done' ? 'Mark task as planned' : 'Complete task'} disabled={diary.saving} onclick={() => diary.toggleTask(task.id)}>{#if task.status === 'done'}<CheckIcon class="size-5 text-emerald-500" />{:else}<CircleIcon class="size-5 text-muted-foreground" />{/if}</Button>
              <div class="min-w-0 flex-1"><div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full" style={`background:${category.color}`}></span>{category.name}</span>{#if task.time}<time>{task.time}</time>{/if}{#if task.status && task.status !== 'done'}<span class="rounded-full bg-muted px-2 py-0.5">{task.status === 'in-progress' ? 'In progress' : 'Planned'}</span>{/if}</div><div class:opacity-55={task.status === 'done'}><RichText content={task.content} /></div>
                {#if task.media.length}<div class="mt-3"><MediaGallery media={diary.media.filter(item => task.media.some(stored => stored.id === item.id))} /></div>{/if}
              </div><div class="flex shrink-0 flex-col"><Button variant="ghost" size="icon-xs" aria-label="Edit task" disabled={diary.saving} onclick={() => openTask(task)}><PencilIcon class="size-3.5" /></Button><Button variant="ghost" size="icon-xs" aria-label="Delete task" disabled={diary.saving} onclick={() => deleteId = task.id}><Trash2Icon class="size-3.5" /></Button></div>
            </div>
          </li>
        {/each}
      </ul>{/if}
    </section>
  </div>
  <section class="memoro-surface mt-5 p-4 sm:p-6" aria-label="Daily journal">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 class="flex items-center gap-2 text-xl font-semibold tracking-tight"><BookOpenIcon class="size-5 text-primary" />Your journal</h2><p class="mt-1 text-xs text-muted-foreground">{dateLabel}</p></div><div class="flex items-center gap-3"><span role="status" class="text-xs text-muted-foreground">{diary.saving ? diary.progress > 0 && diary.progress < 100 ? `Uploading ${diary.progress}%` : 'Encrypting and saving…' : diary.dirty ? 'Unsaved changes' : diary.feedback}</span><Button size="sm" disabled={diary.loading || diary.saving || !diary.dirty} onclick={() => diary.save()}>{diary.saving ? 'Saving…' : 'Save entry'}</Button></div></header>
    {#if diary.available && !diary.loading}{#key diary.document.date}<EntryEditor bind:entry={diary.document.journal} bind:files={diary.journalFiles} media={diary.media} label="Daily journal text" placeholder="What would you like to remember about today?" pending={diary.saving} onChange={() => {}} />{/key}{/if}
    {#if diary.mediaError}<p role="alert" class="mt-3 text-sm text-destructive">{diary.mediaError}</p>{/if}
  </section>
</main>
<Dialog.Root open={taskOpen} onOpenChange={(value) => { if (!value) closeTask(); }}><Dialog.Content class="max-w-2xl">{#if editor}<TaskEditor bind:task={editor} bind:files={taskFiles} media={diary.media} pending={diary.saving} isNew={!diary.document.tasks.some(task => task.id === editor?.id)} onSave={saveTask} onCancel={() => closeTask()} />{/if}{#if diary.error}<p role="alert" class="text-sm text-destructive">{diary.error}</p>{/if}</Dialog.Content></Dialog.Root>
<AlertDialog.Root open={deleteId !== null} onOpenChange={(value) => { if (!value) deleteId = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>Delete this task?</AlertDialog.Title><AlertDialog.Description>This removes the task and its attachments from this day.</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>Cancel</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground" onclick={() => { if (deleteId) void diary.removeTask(deleteId); deleteId = null; }}>Delete task</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
<AlertDialog.Root bind:open={discardOpen}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>Save your journal before leaving?</AlertDialog.Title><AlertDialog.Description>Your current changes have not been saved.</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel onclick={() => pendingNavigation = null}>Keep editing</AlertDialog.Cancel><Button variant="outline" disabled={diary.saving} onclick={continueNavigation}>Discard changes</Button><Button disabled={diary.saving} onclick={async () => { if (await diary.save()) await continueNavigation(); }}>Save and continue</Button></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
<AlertDialog.Root bind:open={taskDiscardOpen}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>Discard this task draft?</AlertDialog.Title><AlertDialog.Description>The changes in this task have not been saved.</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel onclick={() => pendingNavigation = null}>Keep editing</AlertDialog.Cancel><AlertDialog.Action onclick={() => { closeTask(true); if (pendingNavigation) { if (diary.dirty) discardOpen = true; else void continueNavigation(); } }}>Discard draft</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>

<AlertDialog.Root bind:open={reloadOpen}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>Reload this day?</AlertDialog.Title><AlertDialog.Description>This discards your unsaved journal changes and opens the latest encrypted version.</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>Keep editing</AlertDialog.Cancel><AlertDialog.Action onclick={() => diary.loadDate(date, true)}>Reload day</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
