// Owns cancellable day loading, local drafts and revision-checked encrypted saves
import { onDestroy } from 'svelte';
import { createMemoroRepository, emptyDay, summarize, type DayDocument, type DaySummary, type Task } from '@kaordo/memoro-client';
import type { DraftAttachment } from '@kaordo/editor-ui';
import type { MemoroDay } from '@kaordo/contracts';
import type { MediaAttachment } from '@kaordo/media-ui';

export function createMemoroState(apiBaseUrl: string, nodoBaseUrl: string, initialDate: string) {
  const repository = createMemoroRepository(apiBaseUrl, nodoBaseUrl);
  let document = $state<DayDocument>(emptyDay(initialDate));
  let summaries = $state<DaySummary[]>([]);
  let attachments = $state<MediaAttachment[]>([]);
  let journalFiles = $state<DraftAttachment[]>([]);
  let loading = $state(true);
  let available = $state(false);
  let monthLoading = $state(false);
  let saving = $state(false);
  let error = $state('');
  let mediaError = $state('');
  let feedback = $state('');
  let progress = $state(0);
  let revision = 0;
  let snapshot = $state('');
  let record: MemoroDay | null = null;
  let dateRequest: AbortController | undefined;
  let monthRequest: AbortController | undefined;
  let monthVersion = 0;
  let visibleMonth = initialDate.slice(0, 7);
  let disposed = false;
  const lifetime = new AbortController();
  const dirty = $derived(!loading && (JSON.stringify(document) !== snapshot || journalFiles.length > 0));

  async function loadMonth(month: string) {
    visibleMonth = month;
    const version = ++monthVersion;
    monthRequest?.abort(); const request = new AbortController(); monthRequest = request;
    monthLoading = true;
    try {
      const result = await repository.month(month, AbortSignal.any([request.signal, lifetime.signal]));
      if (!disposed && version === monthVersion) summaries = result;
    } catch (cause) { if (!disposed && !request.signal.aborted && version === monthVersion) error = message(cause); }
    finally { if (!disposed && version === monthVersion) monthLoading = false; }
  }
  async function loadDate(date: string, reload = false) {
    if (saving || disposed) return;
    dateRequest?.abort();
    const request = new AbortController(); dateRequest = request;
    clearDrafts(journalFiles); journalFiles = []; repository.clearMedia(); attachments = [];
    document = emptyDay(date); snapshot = JSON.stringify(document); revision = 0; record = null;
    loading = true; available = false; error = ''; feedback = ''; mediaError = '';
    try {
      const result = await repository.day(date, reload, AbortSignal.any([request.signal, lifetime.signal]));
      request.signal.throwIfAborted();
      clearDrafts(journalFiles); journalFiles = [];
      repository.clearMedia(); attachments = [];
      document = result.document; snapshot = JSON.stringify(document); revision = result.revision; record = result.record;
      loading = false; available = true;
      void loadMedia(request.signal);
    } catch (cause) { if (!request.signal.aborted && !disposed) { error = message(cause); loading = false; } }
  }
  async function loadMedia(signal: AbortSignal) {
    try {
      const result = await repository.media(document, record, signal);
      if (!disposed && !signal.aborted) attachments = result;
    } catch (cause) { if (!disposed && !signal.aborted) mediaError = message(cause); }
  }
  async function save(task?: Task, files: DraftAttachment[] = []): Promise<boolean> {
    if (saving || loading || !available || disposed) return false;
    if (document.tasks.length >= 200 && task && !document.tasks.some(value => value.id === task.id)) { error = 'A day can contain at most 200 tasks.'; return false; }
    saving = true; error = ''; feedback = ''; progress = 0;
    try {
      if (task) {
        if (files.length) { task.media = [...task.media, ...await repository.upload(document.date, files, lifetime.signal, value => progress = value)]; clearDrafts(files); files.splice(0); }
      }
      if (journalFiles.length) {
        const media = await repository.upload(document.date, journalFiles, lifetime.signal, value => progress = value);
        document.journal.media = [...document.journal.media, ...media]; clearDrafts(journalFiles); journalFiles = [];
      }
      const candidate = structuredClone($state.snapshot(document));
      if (task) {
        const draft = structuredClone($state.snapshot(task));
        candidate.tasks = candidate.tasks.some(value => value.id === draft.id)
          ? candidate.tasks.map(value => value.id === draft.id ? draft : value) : [...candidate.tasks, draft];
      }
      record = await repository.save(candidate, revision, lifetime.signal);
      lifetime.signal.throwIfAborted();
      document = candidate;
      revision = record.revision; snapshot = JSON.stringify(document); feedback = 'Saved';
      summaries = [...summaries.filter(value => value.date !== document.date), summarize(document)];
      if (visibleMonth !== document.date.slice(0, 7)) void loadMonth(visibleMonth);
      void loadMedia(dateRequest?.signal ?? lifetime.signal);
      return true;
    } catch (cause) { if (!disposed) error = message(cause); return false; }
    finally { if (!disposed) saving = false; }
  }
  async function removeTask(id: string) { document.tasks = document.tasks.filter(task => task.id !== id); await save(); }
  async function toggleTask(id: string) { document.tasks = document.tasks.map(task => task.id === id ? { ...task, status: task.status === 'done' ? 'planned' : 'done' } : task); await save(); }
  onDestroy(() => {
    disposed = true; lifetime.abort(); dateRequest?.abort(); monthRequest?.abort(); ++monthVersion;
    repository.dispose(); clearDrafts(journalFiles);
  });
  return { get document() { return document; }, get summaries() { return summaries; }, get media() { return attachments; },
    get journalFiles() { return journalFiles; }, set journalFiles(value) { journalFiles = value; },
    get loading() { return loading; }, get available() { return available; }, get monthLoading() { return monthLoading; }, get saving() { return saving; }, get dirty() { return dirty; },
    get error() { return error; }, get mediaError() { return mediaError; }, get feedback() { return feedback; }, get progress() { return progress; },
    loadMonth, loadDate, save, removeTask, toggleTask };
}
export function clearDrafts(files: DraftAttachment[]) { for (const file of files) URL.revokeObjectURL(file.preview); }
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'The encrypted diary request failed.'; }
