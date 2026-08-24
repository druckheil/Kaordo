import type { Env } from '../env';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';

const MAX_BODY_BYTES = 64 * 1024;
// Keep a full replace inside D1's bounded batch size (delete + one row per plan).
const MAX_PLANS = 80;
const MAX_EVENTS = 200;
const TIMEZONE = 'Europe/Berlin';
const VALID_STATUSES = new Set(['pending', 'done', 'skipped']);

type PlanRow = {
  accent: number;
  created_at: number;
  day: string;
  plan_id: string;
  position: number;
  text: string;
};

type DiaryRow = { day: string; mood: string; plan_state: string; text: string };

type EventRow = {
  created_at: number;
  description: string;
  event_at: number;
  id: string;
  notify_at_event_time: number;
  remind_offset_min: number | null;
  reminder_enabled: number;
  title: string;
  updated_at: number;
};

type PlanInput = { accent: boolean; createdDate?: string; id: string; text: string };
type DiaryInput = {
  mood: string;
  planState: Record<string, { checked: boolean; status: string }>;
  text: string;
};
export async function taglibroBootstrap(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const now = unixNow();
    const day = localDate(now);
    const [plansResult, diaryResult, eventsResult] = await env.DB.batch([
      plansStatement(env, session.userId, day),
      diaryStatement(env, session.userId, day),
      eventsStatement(env, session.userId, false),
    ]);
    const today = dayPayload(day, rows<PlanRow>(plansResult), firstRow<DiaryRow>(diaryResult));
    return json({ events: rows<EventRow>(eventsResult).map((row) => eventPayload(row, now)), today, timezone: TIMEZONE });
  } catch (error) {
    return failure('bootstrap', error);
  }
}

export async function taglibroDay(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const date = validDate(new URL(request.url).searchParams.get('date') ?? localDate(unixNow()));
    return json(await dayFor(env, session.userId, date));
  } catch (error) {
    return failure('load day', error);
  }
}

export async function taglibroSavePlans(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readJson(request);
    const date = validDate(input.date);
    const plans = planInputs(input.plans, date);
    const now = unixNow();
    const statements = [env.DB.prepare('DELETE FROM ilo_tag_plans WHERE user_id = ?1 AND day = ?2').bind(session.userId, date)];
    for (const [position, plan] of plans.entries()) {
      statements.push(env.DB.prepare(
        `INSERT INTO ilo_tag_plans
          (user_id, day, plan_id, position, text, accent, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      ).bind(session.userId, date, plan.id, position, plan.text, plan.accent ? 1 : 0, now));
    }
    await env.DB.batch(statements);
    return json(await dayFor(env, session.userId, date));
  } catch (error) {
    return failure('save plans', error);
  }
}

export async function taglibroSaveDiary(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readJson(request);
    const date = validDate(input.date);
    const diaryValue = input.diary && typeof input.diary === 'object' && !Array.isArray(input.diary)
      ? input.diary as Record<string, unknown>
      : input;
    const diary = diaryInput(diaryValue);
    await upsertDiary(env, session.userId, date, diary, unixNow());
    return json(await dayFor(env, session.userId, date));
  } catch (error) {
    return failure('save diary', error);
  }
}

export async function taglibroSaveDay(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readJson(request);
    const date = validDate(input.date);
    const plans = planInputs(input.plans, date);
    const diary = diaryInput(input.diary && typeof input.diary === 'object' && !Array.isArray(input.diary)
      ? input.diary as Record<string, unknown>
      : {});
    const now = unixNow();
    const statements = [env.DB.prepare('DELETE FROM ilo_tag_plans WHERE user_id = ?1 AND day = ?2').bind(session.userId, date)];
    for (const [position, plan] of plans.entries()) {
      statements.push(env.DB.prepare(
        `INSERT INTO ilo_tag_plans
          (user_id, day, plan_id, position, text, accent, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      ).bind(session.userId, date, plan.id, position, plan.text, plan.accent ? 1 : 0, now));
    }
    statements.push(diaryUpsertStatement(env, session.userId, date, diary, now));
    await env.DB.batch(statements);
    return json(await dayFor(env, session.userId, date));
  } catch (error) {
    return failure('save day', error);
  }
}

export async function taglibroEvents(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const includePast = new URL(request.url).searchParams.get('includePast') === '1';
    const result = await eventsStatement(env, session.userId, includePast).all<EventRow>();
    return json({ events: rows<EventRow>(result).map((row) => eventPayload(row, unixNow())) });
  } catch (error) {
    return failure('list events', error);
  }
}

export async function taglibroCreateEvent(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = eventInput(await readJson(request));
    const now = unixNow();
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    await env.DB.prepare(
      `INSERT INTO ilo_tag_events
        (user_id, id, title, description, event_at, reminder_enabled,
         remind_offset_min, notify_at_event_time, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    ).bind(
      session.userId, id, input.title, input.description, input.eventAt,
      input.reminderEnabled ? 1 : 0, input.remindOffsetMin,
      input.notifyAtEventTime ? 1 : 0, now,
    ).run();
    const row = await env.DB.prepare(
      `SELECT id, title, description, event_at, reminder_enabled,
              remind_offset_min, notify_at_event_time, created_at, updated_at
         FROM ilo_tag_events WHERE user_id = ?1 AND id = ?2 LIMIT 1`,
    ).bind(session.userId, id).first<EventRow>();
    if (!row) throw new Error('The event was not saved.');
    return json(eventPayload(row, now), 201);
  } catch (error) {
    return failure('create event', error);
  }
}

export async function taglibroUpdateEvent(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!validId(eventId)) return json({ error: 'Event identifier is invalid.' }, 400);
  try {
    const input = eventInput(await readJson(request));
    const now = unixNow();
    const result = await env.DB.prepare(
      `UPDATE ilo_tag_events
          SET title = ?1, description = ?2, event_at = ?3,
              reminder_enabled = ?4, remind_offset_min = ?5,
              notify_at_event_time = ?6, reminder_sent = 0,
              reminder_sent_at = NULL, notify_sent = 0, notify_sent_at = NULL,
              updated_at = ?7
        WHERE user_id = ?8 AND id = ?9`,
    ).bind(
      input.title, input.description, input.eventAt, input.reminderEnabled ? 1 : 0,
      input.remindOffsetMin, input.notifyAtEventTime ? 1 : 0, now,
      session.userId, eventId,
    ).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Event was not found.' }, 404);
    const row = await env.DB.prepare(
      `SELECT id, title, description, event_at, reminder_enabled,
              remind_offset_min, notify_at_event_time, created_at, updated_at
         FROM ilo_tag_events WHERE user_id = ?1 AND id = ?2 LIMIT 1`,
    ).bind(session.userId, eventId).first<EventRow>();
    if (!row) return json({ error: 'Event was not found.' }, 404);
    return json(eventPayload(row, now));
  } catch (error) {
    return failure('update event', error);
  }
}

export async function taglibroDeleteEvent(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!validId(eventId)) return json({ error: 'Event identifier is invalid.' }, 400);
  try {
    const result = await env.DB.prepare('DELETE FROM ilo_tag_events WHERE user_id = ?1 AND id = ?2')
      .bind(session.userId, eventId).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Event was not found.' }, 404);
    return json({ ok: true });
  } catch (error) {
    return failure('delete event', error);
  }
}

async function dayFor(env: Env, userId: ArrayBuffer, date: string) {
  const [plansResult, diaryResult] = await env.DB.batch([
    plansStatement(env, userId, date),
    diaryStatement(env, userId, date),
  ]);
  return dayPayload(date, rows<PlanRow>(plansResult), firstRow<DiaryRow>(diaryResult));
}

async function upsertDiary(env: Env, userId: ArrayBuffer, date: string, diary: DiaryInput, now: number): Promise<void> {
  await diaryUpsertStatement(env, userId, date, diary, now).run();
}

function diaryUpsertStatement(env: Env, userId: ArrayBuffer, date: string, diary: DiaryInput, now: number) {
  return env.DB.prepare(
    `INSERT INTO ilo_tag_diary(user_id, day, text, mood, plan_state, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(user_id, day) DO UPDATE SET
       text = excluded.text, mood = excluded.mood,
       plan_state = excluded.plan_state, updated_at = excluded.updated_at`,
  ).bind(userId, date, diary.text, diary.mood, JSON.stringify(diary.planState), now);
}

function plansStatement(env: Env, userId: ArrayBuffer, date: string) {
  return env.DB.prepare(
    `SELECT day, plan_id, position, text, accent, created_at
       FROM ilo_tag_plans WHERE user_id = ?1 AND day = ?2
      ORDER BY position ASC, plan_id ASC`,
  ).bind(userId, date);
}

function diaryStatement(env: Env, userId: ArrayBuffer, date: string) {
  return env.DB.prepare(
    'SELECT day, text, mood, plan_state FROM ilo_tag_diary WHERE user_id = ?1 AND day = ?2 LIMIT 1',
  ).bind(userId, date);
}

function eventsStatement(env: Env, userId: ArrayBuffer, includePast: boolean) {
  const now = unixNow();
  return env.DB.prepare(
    `SELECT id, title, description, event_at, reminder_enabled,
            remind_offset_min, notify_at_event_time, created_at, updated_at
       FROM ilo_tag_events
      WHERE user_id = ?1 AND (?2 = 1 OR event_at >= ?3)
      ORDER BY event_at ASC, id ASC LIMIT ${MAX_EVENTS}`,
  ).bind(userId, includePast ? 1 : 0, now);
}

function dayPayload(date: string, planRows: PlanRow[], diaryRow: DiaryRow | null) {
  return {
    date,
    diary: {
      mood: diaryRow?.mood || '🙂',
      planState: parsePlanState(diaryRow?.plan_state),
      text: diaryRow?.text || '',
    },
    plans: planRows.map((row) => ({
      accent: Boolean(row.accent),
      createdDate: row.day,
      id: row.plan_id,
      text: row.text,
    })),
  };
}

function eventPayload(row: EventRow, now: number) {
  return {
    createdAt: Number(row.created_at),
    description: row.description,
    eventAt: Number(row.event_at),
    eventIso: new Date(Number(row.event_at) * 1_000).toISOString(),
    id: row.id,
    notifyAtEventTime: Boolean(row.notify_at_event_time),
    remindOffsetMin: row.remind_offset_min === null ? null : Number(row.remind_offset_min),
    reminderEnabled: Boolean(row.reminder_enabled),
    remainingSeconds: Number(row.event_at) - now,
    title: row.title,
    updatedAt: Number(row.updated_at),
  };
}

function planInputs(value: unknown, date: string): PlanInput[] {
  if (!Array.isArray(value) || value.length > MAX_PLANS) throw new TaglibroInputError('Plans are invalid.');
  const ids = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new TaglibroInputError('Plans are invalid.');
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!validId(id) || ids.has(id) || text.length > 512) throw new TaglibroInputError('A plan item is invalid.');
    ids.add(id);
    return { accent: Boolean(item.accent), createdDate: date, id, text };
  });
}

function diaryInput(input: Record<string, unknown>): DiaryInput {
  const text = typeof input.text === 'string' ? input.text : '';
  const mood = typeof input.mood === 'string' && input.mood.trim() ? input.mood.trim() : '🙂';
  const rawState = input.planState ?? input.plan_state;
  if (text.length > 16_000 || mood.length > 8) throw new TaglibroInputError('Diary content is invalid.');
  const planState: DiaryInput['planState'] = {};
  if (rawState && typeof rawState === 'object' && !Array.isArray(rawState)) {
    for (const [id, raw] of Object.entries(rawState)) {
      if (!validId(id) || typeof raw !== 'object' || raw === null) continue;
      const state = raw as Record<string, unknown>;
      const status = typeof state.status === 'string' && VALID_STATUSES.has(state.status) ? state.status : 'pending';
      planState[id] = { checked: Boolean(state.checked), status };
    }
  }
  return { mood, planState, text };
}

function eventInput(input: Record<string, unknown>): { description: string; eventAt: number; notifyAtEventTime: boolean; remindOffsetMin: number | null; reminderEnabled: boolean; title: string } {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const dateValue = typeof input.eventAt === 'string' ? input.eventAt : typeof input.event_at === 'string' ? input.event_at : '';
  const eventAt = Date.parse(dateValue);
  const reminderEnabled = Boolean(input.reminderEnabled ?? input.reminder_enabled);
  const rawOffset = input.remindOffsetMin ?? input.remind_offset_min;
  const remindOffsetMin = rawOffset === null || rawOffset === undefined || rawOffset === '' ? null : Number(rawOffset);
  if (!title || title.length > 256 || description.length > 2_000 || !Number.isFinite(eventAt) || eventAt < Date.now() - 366 * 86_400_000) {
    throw new TaglibroInputError('Event details are invalid.');
  }
  if (reminderEnabled && (!Number.isInteger(remindOffsetMin) || (remindOffsetMin as number) < 1 || (remindOffsetMin as number) > 43_200)) {
    throw new TaglibroInputError('Reminder interval is invalid.');
  }
  return {
    description,
    eventAt: Math.floor(eventAt / 1_000),
    notifyAtEventTime: Boolean(input.notifyAtEventTime ?? input.notify_at_event_time),
    remindOffsetMin: reminderEnabled ? remindOffsetMin : null,
    reminderEnabled,
    title,
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new TaglibroInputError('Content-Type must be application/json.');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new TaglibroInputError('Taglibroplanilo request is too large.');
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new TaglibroInputError('Invalid JSON.');
  }
}

function parsePlanState(value: string | undefined): Record<string, { checked: boolean; status: 'pending' | 'done' | 'skipped' }> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, { checked: boolean; status: 'pending' | 'done' | 'skipped' }> = {};
    for (const [id, raw] of Object.entries(parsed)) {
      if (!validId(id) || typeof raw !== 'object' || raw === null) continue;
      const state = raw as Record<string, unknown>;
      const status = typeof state.status === 'string' && VALID_STATUSES.has(state.status)
        ? state.status as 'pending' | 'done' | 'skipped' : 'pending';
      result[id] = { checked: Boolean(state.checked), status };
    }
    return result;
  } catch {
    return {};
  }
}

function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new TaglibroInputError('Date is invalid.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TaglibroInputError('Date is invalid.');
  return value;
}

function validId(value: string): boolean { return /^[0-9a-f]{8,32}$/u.test(value); }

function localDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit', month: '2-digit', timeZone: TIMEZONE, year: 'numeric',
  }).formatToParts(new Date(timestamp * 1_000));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function rows<T>(result: D1Result<unknown>): T[] { return result.results as T[]; }
function firstRow<T>(result: D1Result<unknown>): T | null { return rows<T>(result)[0] ?? null; }

function failure(operation: string, error: unknown): Response {
  const message = error instanceof TaglibroInputError
    ? error.message
    : error instanceof Error && error.message.trim() ? error.message : 'Taglibroplanilo is unavailable.';
  if (!(error instanceof TaglibroInputError)) console.error(`[taglibroplanilo] ${operation}`, error);
  return json({ error: message }, error instanceof TaglibroInputError ? 400 : 500);
}

class TaglibroInputError extends Error {}
