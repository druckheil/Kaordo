<script lang="ts">
  import {
    EMPTY_TAGLIBRO_DAY,
    type TaglibroDay,
    type TaglibroEvent,
    type TaglibroEventInput,
    type TaglibroPlan,
    type TaglibroPlanState,
    type TaglibroSnapshot,
    type TaglibroTab,
  } from '../../lib/domain/ilo';
  import type { IloGState } from '../../lib/states/IloGState';

  type Props = { snapshot: Readonly<TaglibroSnapshot>; state: IloGState };
  let { snapshot, state: iloState }: Props = $props();

  const MOODS = ['🙂', '😐', '😞', '😡', '😴', '🤩', '😌', '😰', '🥳', '🤒', '😁', '😂', '😊', '😉', '😍', '😎', '🤔', '😭', '😤', '🥶', '🤯', '😇', '🤗', '🤓'];
  const STATUSES: Array<TaglibroPlanState['status']> = ['pending', 'done', 'skipped'];
  const TABS: Array<{ id: TaglibroTab; label: string; icon: string }> = [
    { id: 'plans', label: 'Plans', icon: '☷' },
    { id: 'diary', label: 'Diary', icon: '▤' },
    { id: 'calendar', label: 'Calendar', icon: '□' },
    { id: 'events', label: 'Events', icon: '◷' },
  ];

  let activeTab = $state<TaglibroTab>('plans');
  let plansDraft = $state<TaglibroPlan[]>([]);
  let diaryDraft = $state<TaglibroDay['diary']>({ mood: '🙂', planState: {}, text: '' });
  let calendarDate = $state('');
  let syncedDayKey = $state('');
  let moodOpen = $state(false);
  let eventEditingId = $state<string | null>(null);
  let eventTitle = $state('');
  let eventAt = $state('');
  let eventDescription = $state('');
  let eventReminder = $state('');
  let eventNotify = $state(false);
  let showPast = $state(false);

  let todayDay = $derived(snapshot.bootstrap?.today ?? EMPTY_TAGLIBRO_DAY(todayIso()));
  let selectedDay = $derived(snapshot.calendar ?? todayDay);

  $effect(() => {
    const day = activeTab === 'calendar' ? selectedDay : todayDay;
    const dayKey = day.date ? JSON.stringify(day) : '';
    if (!dayKey || dayKey === syncedDayKey) return;
    syncedDayKey = dayKey;
    if (!calendarDate) calendarDate = day.date;
    plansDraft = clonePlans(day.plans);
    diaryDraft = cloneDiary(day.diary);
  });

  function todayIso(): string {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function clonePlans(plans: TaglibroPlan[]): TaglibroPlan[] {
    return plans.map((plan) => ({ ...plan }));
  }

  function cloneDiary(diary: TaglibroDay['diary']): TaglibroDay['diary'] {
    return { mood: diary.mood || '🙂', planState: Object.fromEntries(Object.entries(diary.planState ?? {}).map(([id, value]) => [id, { ...value }])), text: diary.text || '' };
  }

  function openTab(tab: TaglibroTab): void {
    activeTab = tab;
    moodOpen = false;
    if (tab === 'calendar') {
      if (!calendarDate) calendarDate = todayDay.date || todayIso();
      void iloState.loadTaglibroDay(calendarDate);
    } else if (tab === 'events') {
      void iloState.loadTaglibroEvents(showPast);
    }
  }

  function updatePlan(index: number, patch: Partial<TaglibroPlan>): void {
    plansDraft = plansDraft.map((plan, itemIndex) => itemIndex === index ? { ...plan, ...patch } : plan);
  }

  function addPlan(): void {
    plansDraft = [...plansDraft, { accent: false, createdDate: currentDate(), id: randomId(), text: '' }];
  }

  function movePlan(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= plansDraft.length) return;
    const next = [...plansDraft];
    [next[index], next[target]] = [next[target]!, next[index]!];
    plansDraft = next;
  }

  function removePlan(index: number): void { plansDraft = plansDraft.filter((_, itemIndex) => itemIndex !== index); }

  async function savePlans(): Promise<void> {
    await iloState.saveTaglibroPlans(currentDate(), plansDraft);
  }

  function setDiaryState(planId: string, patch: Partial<TaglibroPlanState>): void {
    const existing = diaryDraft.planState[planId] ?? { status: 'pending' as const, checked: false };
    diaryDraft = { ...diaryDraft, planState: { ...diaryDraft.planState, [planId]: { ...existing, ...patch } } };
  }

  async function saveDiary(): Promise<void> {
    await iloState.saveTaglibroDiary(currentDate(), diaryDraft);
  }

  async function saveCalendar(): Promise<void> {
    await iloState.saveTaglibroDay(calendarDate, { diary: diaryDraft, plans: plansDraft });
  }

  function currentDate(): string { return activeTab === 'calendar' ? calendarDate : todayDay.date || todayIso(); }

  function changeCalendarDate(value: string): void {
    calendarDate = value;
    syncedDayKey = '';
    void iloState.loadTaglibroDay(value, true);
  }

  function resetEventForm(): void {
    eventEditingId = null;
    eventTitle = '';
    eventAt = '';
    eventDescription = '';
    eventReminder = '';
    eventNotify = false;
  }

  function editEvent(event: TaglibroEvent): void {
    eventEditingId = event.id;
    eventAt = toDateTimeLocal(event.eventIso);
    eventTitle = event.title;
    eventDescription = event.description;
    eventReminder = event.remindOffsetMin ? String(event.remindOffsetMin) : '';
    eventNotify = event.notifyAtEventTime;
  }

  async function submitEvent(): Promise<void> {
    if (!eventTitle.trim() || !eventAt) return;
    const input: TaglibroEventInput = {
      description: eventDescription.trim(),
      eventAt: new Date(eventAt).toISOString(),
      notifyAtEventTime: eventNotify,
      remindOffsetMin: eventReminder ? Number(eventReminder) : null,
      reminderEnabled: Boolean(eventReminder),
      title: eventTitle.trim(),
    };
    const saved = eventEditingId
      ? await iloState.updateTaglibroEvent(eventEditingId, input)
      : await iloState.createTaglibroEvent(input);
    if (saved) resetEventForm();
  }

  async function deleteEvent(id: string): Promise<void> {
    if (window.confirm('Delete this event?')) await iloState.deleteTaglibroEvent(id);
  }

  function toDateTimeLocal(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function formatEvent(event: TaglibroEvent): string {
    return new Date(event.eventIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function remaining(event: TaglibroEvent): string {
    const seconds = event.remainingSeconds;
    if (seconds < 0) return 'Past';
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    if (days) return `in ${days}d ${hours}h`;
    if (hours) return `in ${hours}h ${minutes}m`;
    return `in ${Math.max(1, minutes)}m`;
  }

  function randomId(): string { return crypto.randomUUID().replaceAll('-', '').slice(0, 12); }
  function statusLabel(status: string): string { return status[0]!.toUpperCase() + status.slice(1); }
</script>

<section class="taglibro-shell" aria-labelledby="taglibro-title">
  <header class="tag-header">
    <div class="tag-heading">
      <span class="tag-mark" aria-hidden="true">T</span>
      <div><span class="eyebrow">Personal planner</span><h1 id="taglibro-title">Taglibroplanilo</h1><p>A calm place for plans, diary entries, and the moments you want to remember.</p></div>
    </div>
    <div class="tag-actions"><span class="save-state"><i></i>{snapshot.error ? 'Needs attention' : 'Synced'}</span><button class:loading={snapshot.refreshing} type="button" disabled={snapshot.refreshing || snapshot.busy !== null} onclick={() => iloState.refreshTaglibro(true)}><span aria-hidden="true">↻</span>{snapshot.refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
  </header>

  <nav class="tag-tabs" aria-label="Taglibroplanilo sections">
    {#each TABS as tab}<button class:active={activeTab === tab.id} type="button" onclick={() => openTab(tab.id)}><span aria-hidden="true">{tab.icon}</span>{tab.label}{#if tab.id === 'events' && snapshot.events.length}<b>{snapshot.events.length}</b>{/if}</button>{/each}
  </nav>

  {#if snapshot.error}<div class="tag-error" role="alert"><span aria-hidden="true">!</span><span><strong>Taglibroplanilo could not finish an operation</strong>{snapshot.error}</span><button type="button" aria-label="Dismiss error" onclick={() => iloState.clearTaglibroError()}>×</button></div>{/if}

  {#if snapshot.phase === 'loading'}
    <div class="tag-loading"><span class="spinner"></span><strong>Opening your planner</strong><p>Loading plans, diary, and events…</p></div>
  {:else if activeTab === 'plans'}
    <section class="tag-content" aria-labelledby="plans-title">
      <div class="section-head"><div><span class="eyebrow">{todayDay.date}</span><h2 id="plans-title">Today’s plan</h2><p>Keep the day visible, focused, and easy to reorder.</p></div><button class="primary" type="button" onclick={addPlan}>＋ Add plan</button></div>
      <div class="plan-list">
        {#if plansDraft.length === 0}<div class="empty-card"><span>✦</span><strong>No plans yet</strong><p>Add the first small step for today.</p><button class="primary" type="button" onclick={addPlan}>Add a plan</button></div>{/if}
        {#each plansDraft as plan, index (plan.id)}
          <article class:accented={plan.accent} class="plan-row"><span class="plan-index">{String(index + 1).padStart(2, '0')}</span><input aria-label={`Plan ${index + 1}`} value={plan.text} placeholder="What would make today better?" oninput={(event) => updatePlan(index, { text: event.currentTarget.value })} /><div class="row-actions"><button class:active={plan.accent} type="button" aria-label="Highlight plan" onclick={() => updatePlan(index, { accent: !plan.accent })}>☆</button><button type="button" disabled={index === 0} aria-label="Move plan up" onclick={() => movePlan(index, -1)}>↑</button><button type="button" disabled={index === plansDraft.length - 1} aria-label="Move plan down" onclick={() => movePlan(index, 1)}>↓</button><button class="danger" type="button" aria-label="Delete plan" onclick={() => removePlan(index)}>×</button></div></article>
        {/each}
      </div>
      {#if plansDraft.length}<div class="save-row"><span>{plansDraft.length} {plansDraft.length === 1 ? 'item' : 'items'} · drag-free and keyboard friendly</span><button class="primary" type="button" disabled={snapshot.busy !== null} onclick={savePlans}>{snapshot.busy ? 'Saving…' : 'Save plans'}</button></div>{/if}
    </section>
  {:else if activeTab === 'diary'}
    <section class="tag-content" aria-labelledby="diary-title">
      <div class="section-head"><div><span class="eyebrow">{todayDay.date}</span><h2 id="diary-title">Daily diary</h2><p>Mark what happened and leave a note for your future self.</p></div><button class="primary" type="button" disabled={snapshot.busy !== null} onclick={saveDiary}>{snapshot.busy ? 'Saving…' : 'Save diary'}</button></div>
      <div class="diary-grid"><article class="diary-card"><div class="card-label"><span>Mood</span><button class="mood-button" type="button" aria-label="Choose mood" onclick={() => moodOpen = !moodOpen}>{diaryDraft.mood}<span>Choose</span></button></div>{#if moodOpen}<div class="mood-picker">{#each MOODS as mood}<button type="button" onclick={() => { diaryDraft = { ...diaryDraft, mood }; moodOpen = false; }}>{mood}</button>{/each}</div>{/if}<label class="field-label" for="diary-note">Notes</label><textarea id="diary-note" bind:value={diaryDraft.text} placeholder="What happened today?" rows="9"></textarea></article><article class="diary-card"><div class="card-label"><span>Today’s plans</span><small>{plansDraft.length} items</small></div><div class="diary-plans">{#if plansDraft.length === 0}<p class="muted">No plans for today.</p>{/if}{#each plansDraft as plan (plan.id)}{@const itemState = diaryDraft.planState[plan.id] ?? { checked: false, status: 'pending' as const }}<div class:checked={itemState.checked} class:accented={plan.accent} class="diary-plan"><input type="checkbox" checked={itemState.checked} onchange={(event) => setDiaryState(plan.id, { checked: event.currentTarget.checked, status: event.currentTarget.checked ? 'done' : 'pending' })} /><span>{plan.text || 'Untitled plan'}</span><select value={itemState.status} onchange={(event) => setDiaryState(plan.id, { status: event.currentTarget.value as TaglibroPlanState['status'], checked: event.currentTarget.value === 'done' })}>{#each STATUSES as status}<option value={status}>{statusLabel(status)}</option>{/each}</select></div>{/each}</div></article></div>
    </section>
  {:else if activeTab === 'calendar'}
    <section class="tag-content" aria-labelledby="calendar-title">
      <div class="section-head"><div><span class="eyebrow">Explore any day</span><h2 id="calendar-title">Calendar</h2><p>Review plans and diary notes together.</p></div><button class="primary" type="button" disabled={snapshot.busy !== null || !calendarDate} onclick={saveCalendar}>{snapshot.busy ? 'Saving…' : 'Save day'}</button></div>
      <div class="calendar-toolbar"><label for="day-picker">Selected day</label><input id="day-picker" type="date" value={calendarDate || todayDay.date} onchange={(event) => changeCalendarDate(event.currentTarget.value)} /><span>{selectedDay.date || 'Loading…'}</span></div>
      <div class="calendar-grid"><article class="calendar-card"><div class="card-label"><span>Plans</span><button type="button" onclick={addPlan}>＋ Add</button></div><div class="plan-list compact">{#if plansDraft.length === 0}<p class="muted">No plans saved for this day.</p>{/if}{#each plansDraft as plan, index (plan.id)}<article class:accented={plan.accent} class="plan-row"><span class="plan-index">{String(index + 1).padStart(2, '0')}</span><input aria-label={`Plan ${index + 1}`} value={plan.text} oninput={(event) => updatePlan(index, { text: event.currentTarget.value })} /><div class="row-actions"><button type="button" disabled={index === 0} onclick={() => movePlan(index, -1)}>↑</button><button type="button" disabled={index === plansDraft.length - 1} onclick={() => movePlan(index, 1)}>↓</button><button class="danger" type="button" onclick={() => removePlan(index)}>×</button></div></article>{/each}</div></article><article class="calendar-card"><div class="card-label"><span>Diary</span><button class="mood-inline" type="button" onclick={() => diaryDraft = { ...diaryDraft, mood: MOODS[(MOODS.indexOf(diaryDraft.mood) + 1) % MOODS.length]! }}>{diaryDraft.mood}</button></div><textarea bind:value={diaryDraft.text} placeholder="A note for this day…" rows="10"></textarea></article></div>
    </section>
  {:else}
    <section class="tag-content" aria-labelledby="events-title">
      <div class="section-head"><div><span class="eyebrow">Remember what matters</span><h2 id="events-title">Events</h2><p>One-time reminders, kept with the rest of your personal record.</p></div><button class:loading={snapshot.eventsLoading} class="secondary" type="button" disabled={snapshot.eventsLoading} onclick={() => { showPast = !showPast; void iloState.loadTaglibroEvents(showPast, true); }}><span aria-hidden="true">↻</span>{snapshot.eventsLoading ? 'Loading…' : showPast ? 'Hide previous' : 'Show previous'}</button></div>
      <div class="events-layout"><article class="event-form"><div class="card-label"><span>{eventEditingId ? 'Edit event' : 'New event'}</span>{#if eventEditingId}<button type="button" onclick={resetEventForm}>Cancel</button>{/if}</div><label>Title<input bind:value={eventTitle} maxlength="256" placeholder="Dentist, trip, call…" /></label><label>Date & time<input type="datetime-local" bind:value={eventAt} /></label><label>Description<textarea bind:value={eventDescription} rows="4" maxlength="2000" placeholder="Optional context"></textarea></label><div class="reminder-row"><label>Reminder<select bind:value={eventReminder}><option value="">No reminder</option><option value="10">10 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="180">3 hours before</option><option value="1440">1 day before</option></select></label><label class="check-label"><input type="checkbox" bind:checked={eventNotify} /> Exact time</label></div><button class="primary full" type="button" disabled={snapshot.busy !== null || !eventTitle.trim() || !eventAt} onclick={submitEvent}>{snapshot.busy ? 'Saving…' : eventEditingId ? 'Save event' : 'Add event'}</button></article><div class="event-list">{#if snapshot.events.length === 0}<div class="empty-card"><span>◷</span><strong>{showPast ? 'No events yet' : 'No upcoming events'}</strong><p>Add a date to keep it visible.</p></div>{/if}{#each snapshot.events as event (event.id)}<article class:past={event.remainingSeconds < 0} class="event-card"><div class="event-date"><strong>{new Date(event.eventIso).getDate()}</strong><span>{new Date(event.eventIso).toLocaleDateString(undefined, { month: 'short' })}</span></div><div class="event-main"><h3>{event.title}</h3><p>{formatEvent(event)} · {remaining(event)}</p>{#if event.description}<span>{event.description}</span>{/if}<small>{event.reminderEnabled ? `Reminder: ${event.remindOffsetMin} min before` : 'No reminder'}{event.notifyAtEventTime ? ' · Exact time' : ''}</small></div><div class="event-actions"><button type="button" onclick={() => editEvent(event)}>Edit</button><button class="danger" type="button" onclick={() => deleteEvent(event.id)}>Delete</button></div></article>{/each}</div></div>
    </section>
  {/if}
</section>

<style>
  .taglibro-shell { min-width: 0; color: #34423a; animation: taglibro-enter 220ms cubic-bezier(.22, 1, .36, 1) both; }
  .tag-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 100px; padding: 18px 30px; background: color-mix(in srgb, var(--canvas) 86%, transparent); border-bottom: 1px solid var(--line); }
  .tag-heading { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .tag-mark { display: grid; width: 52px; height: 52px; flex: none; color: #f8fbf9; background: linear-gradient(145deg, #835e9a, #5c3977); border: 1px solid #5c3977; border-radius: 15px; box-shadow: 0 10px 24px rgb(92 57 119 / 18%); font-size: calc(20px * var(--text-scale)); font-weight: 730; place-items: center; }
  .eyebrow { color: #6b8f7e; font-size: calc(8px * var(--text-scale)); font-weight: 770; letter-spacing: .13em; text-transform: uppercase; }
  .tag-heading h1, .section-head h2 { margin: 3px 0 0; color: #293930; font-weight: 730; letter-spacing: -.035em; }
  .tag-heading h1 { font-size: calc(22px * var(--text-scale)); }
  .tag-heading p, .section-head p { margin-top: 4px; color: #87928b; font-size: calc(8px * var(--text-scale)); }
  .tag-actions { display: flex; align-items: center; gap: 12px; }
  .save-state { display: inline-flex; align-items: center; gap: 6px; color: #75847b; font-size: calc(8px * var(--text-scale)); font-weight: 660; }
  .save-state i { width: 7px; height: 7px; background: #6f9a87; border-radius: 50%; box-shadow: 0 0 0 4px rgb(111 154 135 / 10%); }
  .tag-actions button, .section-head button, .calendar-card .card-label button, .event-form .card-label button { height: 35px; padding: 0 13px; color: #537467; background: #f4f8f6; border: 1px solid #cddbd4; border-radius: 10px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 710; }
  .tag-actions button.loading span { display: inline-block; animation: spin .8s linear infinite; }
  .section-head button.loading span { display: inline-block; animation: spin .8s linear infinite; }
  .tag-tabs { display: flex; align-items: center; gap: 4px; min-height: 53px; padding: 8px 30px; background: color-mix(in srgb, var(--panel) 45%, transparent); border-bottom: 1px solid var(--line); }
  .tag-tabs button { display: inline-flex; align-items: center; gap: 7px; height: 35px; padding: 0 13px; color: #78857d; background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 680; }
  .tag-tabs button:hover, .tag-tabs button.active { color: #654579; background: #f2edf5; }
  .tag-tabs button b { display: grid; min-width: 17px; height: 17px; padding: 0 4px; color: #fff; background: #7d5b91; border-radius: 999px; font-size: calc(6px * var(--text-scale)); place-items: center; }
  .tag-error { display: flex; align-items: center; gap: 10px; margin: 10px 30px 0; padding: 10px 12px; color: #9d4f45; background: #fff1ef; border: 1px solid #edcec8; border-radius: 11px; font-size: calc(8px * var(--text-scale)); }
  .tag-error > span:first-child { display: grid; width: 19px; height: 19px; color: #fff; background: #bf735e; border-radius: 50%; place-items: center; font-weight: 800; }
  .tag-error span:nth-child(2) { display: grid; gap: 2px; }
  .tag-error button { margin-left: auto; color: inherit; background: transparent; border: 0; cursor: pointer; font-size: 18px; }
  .tag-loading { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 430px; color: #819087; text-align: center; }
  .spinner { width: 36px; height: 36px; margin-bottom: 14px; border: 3px solid #e2e9e4; border-top-color: #79548d; border-radius: 50%; animation: spin .75s linear infinite; }
  .tag-loading strong { color: #4c5d53; font-size: calc(12px * var(--text-scale)); }
  .tag-loading p { margin-top: 6px; font-size: calc(8px * var(--text-scale)); }
  .tag-content { max-width: 1120px; margin: 0 auto; padding: 26px 30px 38px; }
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
  .section-head h2 { font-size: calc(22px * var(--text-scale)); }
  .primary { color: #fff !important; background: linear-gradient(145deg, #79568d, #5c3977) !important; border-color: #5c3977 !important; box-shadow: 0 8px 18px rgb(92 57 119 / 15%); }
  .secondary { background: #fff !important; }
  .plan-list { display: grid; gap: 8px; }
  .plan-row { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 62px; padding: 8px 12px; background: rgb(255 255 255 / 88%); border: 1px solid #dce4df; border-radius: 13px; transition: border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease; }
  .plan-row:hover { border-color: #c6b5ce; box-shadow: 0 8px 20px rgb(55 40 69 / 5%); transform: translateY(-1px); }
  .plan-row.accented { border-left: 3px solid #b779c5; background: #fcf8fd; }
  .plan-index { color: #9caaa1; font-size: calc(9px * var(--text-scale)); font-variant-numeric: tabular-nums; font-weight: 720; }
  .plan-row input { min-width: 0; height: 39px; padding: 0 10px; color: #394a41; background: transparent; border: 1px solid transparent; border-radius: 8px; outline: none; font-size: calc(10px * var(--text-scale)); }
  .plan-row input:focus { background: #fff; border-color: #cdbbd4; }
  .row-actions { display: flex; gap: 3px; }
  .row-actions button { display: grid; width: 29px; height: 29px; color: #8a978f; background: transparent; border: 0; border-radius: 7px; cursor: pointer; place-items: center; font-size: 15px; }
  .row-actions button:hover, .row-actions button.active { color: #754f86; background: #f1eaf4; }
  .row-actions button:disabled { cursor: default; opacity: .3; }
  .row-actions button.danger { color: #b06c5b; }
  .save-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 16px; padding: 12px 4px; color: #8b9890; font-size: calc(8px * var(--text-scale)); }
  .empty-card { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 250px; padding: 25px; background: rgb(255 255 255 / 72%); border: 1px dashed #d2ded6; border-radius: 17px; text-align: center; }
  .empty-card > span { display: grid; width: 42px; height: 42px; margin-bottom: 12px; color: #7d5a90; background: #f0e9f3; border-radius: 13px; place-items: center; font-size: 20px; }
  .empty-card strong { color: #536158; font-size: calc(11px * var(--text-scale)); }
  .empty-card p { margin: 5px 0 13px; color: #909d95; font-size: calc(8px * var(--text-scale)); }
  .empty-card button { height: 34px; padding: 0 12px; border-radius: 9px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .diary-grid, .calendar-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap: 12px; }
  .diary-card, .calendar-card, .event-form { position: relative; padding: 19px; background: rgb(255 255 255 / 88%); border: 1px solid #dce4df; border-radius: 17px; }
  .card-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 15px; color: #66756c; font-size: calc(9px * var(--text-scale)); font-weight: 720; }
  .card-label small { color: #9aa59f; font-size: calc(8px * var(--text-scale)); font-weight: 550; }
  .field-label, .event-form label, .calendar-toolbar label { display: grid; gap: 6px; color: #75847b; font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  textarea, .event-form input, .event-form select, .calendar-toolbar input { width: 100%; padding: 10px 11px; color: #3d4d44; background: #fbfcfb; border: 1px solid #d7e0da; border-radius: 9px; outline: none; font: inherit; font-size: calc(9px * var(--text-scale)); resize: vertical; }
  textarea:focus, .event-form input:focus, .event-form select:focus, .calendar-toolbar input:focus { border-color: #bea9c7; box-shadow: 0 0 0 3px rgb(126 87 145 / 10%); }
  .mood-button { display: inline-flex; align-items: center; gap: 9px; padding: 7px 9px; color: #654579; background: #f3edf5; border: 1px solid #dbcbe1; border-radius: 9px; cursor: pointer; font-size: 19px; }
  .mood-button span { color: #876e93; font-size: calc(7px * var(--text-scale)); font-weight: 650; }
  .mood-picker { position: absolute; z-index: 3; top: 57px; right: 19px; display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; width: 255px; padding: 9px; background: #fff; border: 1px solid #d9cce0; border-radius: 12px; box-shadow: 0 18px 38px rgb(47 33 56 / 18%); }
  .mood-picker button { display: grid; height: 29px; background: transparent; border: 0; border-radius: 6px; cursor: pointer; place-items: center; font-size: 17px; }
  .mood-picker button:hover { background: #f2ebf4; }
  .diary-plans { display: grid; gap: 7px; }
  .diary-plan { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 9px; border-left: 2px solid transparent; border-radius: 8px; }
  .diary-plan.accented { border-left-color: #b779c5; background: #fcf8fd; }
  .diary-plan.checked span { color: #839189; text-decoration: line-through; }
  .diary-plan span { min-width: 0; overflow: hidden; color: #526158; font-size: calc(9px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .diary-plan select { color: #7b8981; background: transparent; border: 0; font-size: calc(7px * var(--text-scale)); }
  .muted { color: #929e97; font-size: calc(8px * var(--text-scale)); }
  .calendar-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 13px; padding: 13px 15px; background: #f7faf8; border: 1px solid #dce6df; border-radius: 12px; }
  .calendar-toolbar input { width: auto; min-width: 150px; }
  .calendar-toolbar span { color: #8d9992; font-size: calc(8px * var(--text-scale)); }
  .calendar-card .card-label button { height: 29px; padding: 0 9px; }
  .plan-list.compact .plan-row { grid-template-columns: 30px minmax(0, 1fr) auto; min-height: 50px; }
  .plan-list.compact .plan-row input { height: 32px; }
  .mood-inline { color: #654579 !important; background: #f3edf5 !important; font-size: 16px !important; }
  .events-layout { display: grid; grid-template-columns: minmax(240px, .75fr) minmax(0, 1.25fr); gap: 13px; align-items: start; }
  .event-form { display: grid; gap: 12px; }
  .event-form .card-label { margin-bottom: 0; }
  .event-form textarea { resize: vertical; }
  .reminder-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 9px; }
  .check-label { display: flex !important; align-items: center; gap: 6px; padding-bottom: 10px; white-space: nowrap; }
  .check-label input { width: auto; }
  .full { width: 100%; }
  .event-list { display: grid; gap: 9px; }
  .event-card { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 14px; background: rgb(255 255 255 / 88%); border: 1px solid #dce4df; border-radius: 14px; }
  .event-card.past { opacity: .64; }
  .event-date { display: grid; width: 45px; height: 49px; color: #765486; background: #f1eaf4; border: 1px solid #ddcde3; border-radius: 11px; place-items: center; align-content: center; }
  .event-date strong { font-size: calc(17px * var(--text-scale)); line-height: 1; }
  .event-date span { font-size: calc(7px * var(--text-scale)); font-weight: 700; text-transform: uppercase; }
  .event-main h3 { margin: 1px 0 0; color: #47574d; font-size: calc(10px * var(--text-scale)); }
  .event-main p, .event-main span, .event-main small { display: block; margin-top: 4px; color: #89968e; font-size: calc(8px * var(--text-scale)); line-height: 1.4; }
  .event-main span { color: #67766d; }
  .event-main small { color: #9b8ca1; }
  .event-actions { display: flex; gap: 4px; }
  .event-actions button { height: 28px; padding: 0 7px; color: #78867e; background: transparent; border: 0; border-radius: 7px; cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 700; }
  .event-actions button:hover { background: #f2edf4; color: #765486; }
  .event-actions .danger { color: #ad6b5b; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes taglibro-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .taglibro-shell, .spinner, .tag-actions button.loading span, .section-head button.loading span { animation: none; } }
  @media (max-width: 950px) { .tag-header { align-items: flex-start; flex-direction: column; } .diary-grid, .calendar-grid, .events-layout { grid-template-columns: 1fr; } }
  @media (max-width: 620px) { .tag-header, .tag-tabs, .tag-content { padding-inline: 16px; } .tag-actions { width: 100%; justify-content: space-between; } .section-head { align-items: flex-start; flex-direction: column; } .plan-row { grid-template-columns: 30px minmax(0, 1fr); } .row-actions { grid-column: 2; } .event-card { grid-template-columns: 42px minmax(0, 1fr); } .event-actions { grid-column: 2; } }
</style>
