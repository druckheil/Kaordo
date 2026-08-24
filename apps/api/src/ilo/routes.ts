import type { Env } from '../env';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';
import { buildTrainingCard, ILO_SRS_SECONDS } from './training';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CARDS_PAGE = 100;
const MAX_DELETE_CARDS = 100;
const MAX_SEARCH = 64;
const THEMES = new Set([
  'food', 'work', 'action', 'home', 'nature', 'travel', 'health', 'people',
  'study', 'adjectives', 'appearance', 'animals', 'body', 'clothes', 'emotions',
  'shopping', 'technology', 'transport', 'weather', 'other',
]);

type CardRow = {
  article: string;
  created_at: number;
  example: string;
  failure_count: number;
  german: string;
  id: string;
  next_review_at: number;
  note: string;
  plural: string;
  stage: number;
  theme: string;
  translation: string;
  updated_at: number;
};

type ProfileRow = {
  last_study_date: string | null;
  native_label: string;
  onboarded: number;
  task_cursor: number;
};

type SummaryRow = { active: number; due: number };
type StageRow = { count: number; stage: number };
type PointRow = { day: string; points: number };

type CardInput = {
  article: string;
  example: string;
  german: string;
  note: string;
  plural: string;
  theme: string;
  translation: string;
};

type Progress = {
  active: number;
  due: number;
  learnedToday: boolean;
  pointsHistory: Array<{ date: string; points: number }>;
  stages: Record<string, number>;
  todayPoints: number;
};

export async function iloBootstrap(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const overview = await overviewFor(env, session.userId);
    return json({
      progress: overview.progress,
      settings: {
        nativeLabel: overview.profile?.native_label ?? 'russian',
        onboarded: Boolean(overview.profile?.onboarded),
      },
      themes: [...THEMES],
      train: overview.train,
    });
  } catch (error) {
    return failure('bootstrap', error);
  }
}

export async function iloCards(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const url = new URL(request.url);
    const query = normalizeSearch(url.searchParams.get('q') ?? '');
    const theme = normalizeTheme(url.searchParams.get('theme') ?? '');
    const offset = boundedInteger(url.searchParams.get('offset'), 0, 100_000);
    const limit = boundedInteger(url.searchParams.get('limit'), 50, MAX_CARDS_PAGE);
    const like = query ? `%${escapeLike(query)}%` : null;
    const rows = await env.DB.prepare(
      `SELECT id, german, translation, theme, article, plural, example, note,
              stage, next_review_at, failure_count, created_at, updated_at
         FROM ilo_cards
        WHERE user_id = ?1
          AND (?2 IS NULL OR german LIKE ?2 ESCAPE '\\' OR translation LIKE ?2 ESCAPE '\\'
               OR example LIKE ?2 ESCAPE '\\' OR note LIKE ?2 ESCAPE '\\' OR theme LIKE ?2 ESCAPE '\\')
          AND (?3 = '' OR theme = ?3)
        ORDER BY updated_at DESC, id DESC
        LIMIT ?4 OFFSET ?5`,
    ).bind(session.userId, like, theme, limit + 1, offset).all<CardRow>();
    const page = rows.results.slice(0, limit);
    return json({
      cards: page.map(cardPayload),
      nextOffset: rows.results.length > limit ? offset + limit : null,
    });
  } catch (error) {
    return failure('cards', error);
  }
}

export async function iloCreateCard(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await cardInput(request);
    const now = unixNow();
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ilo_cards
          (id, user_id, german, translation, theme, article, plural, example, note,
           stage, next_review_at, failure_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, 0, ?10, ?10)`,
      ).bind(
        id, session.userId, input.german, input.translation, input.theme,
        input.article, input.plural, input.example, input.note, now,
      ),
      env.DB.prepare(
        `INSERT INTO ilo_profiles(user_id, onboarded, updated_at)
         VALUES (?1, 1, ?2)
         ON CONFLICT(user_id) DO UPDATE SET onboarded = 1, updated_at = excluded.updated_at`,
      ).bind(session.userId, now),
    ]);
    return json(await mutationPayload(env, session.userId, {
      ...input,
      createdAt: now,
      failureCount: 0,
      id,
      nextReviewAt: now,
      stage: 0,
      updatedAt: now,
    }), 201);
  } catch (error) {
    return failure('create card', error);
  }
}

export async function iloUpdateCard(request: Request, env: Env, cardId: string): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!validCardId(cardId)) return json({ error: 'Card identifier is invalid.' }, 400);
  try {
    const input = await cardInput(request);
    const updatedAt = unixNow();
    const result = await env.DB.prepare(
      `UPDATE ilo_cards
          SET german = ?1, translation = ?2, theme = ?3, article = ?4,
              plural = ?5, example = ?6, note = ?7, updated_at = ?8
        WHERE user_id = ?9 AND id = ?10`,
    ).bind(
      input.german, input.translation, input.theme, input.article, input.plural,
      input.example, input.note, updatedAt, session.userId, cardId,
    ).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Card was not found.' }, 404);
    const [card, overview] = await Promise.all([
      env.DB.prepare(
        `SELECT id, german, translation, theme, article, plural, example, note,
                stage, next_review_at, failure_count, created_at, updated_at
           FROM ilo_cards WHERE user_id = ?1 AND id = ?2 LIMIT 1`,
      ).bind(session.userId, cardId).first<CardRow>(),
      overviewFor(env, session.userId),
    ]);
    return json(mutationFromOverview(overview, card ? cardPayload(card) : null));
  } catch (error) {
    return failure('update card', error);
  }
}

export async function iloDeleteCard(request: Request, env: Env, cardId: string): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!validCardId(cardId)) return json({ error: 'Card identifier is invalid.' }, 400);
  try {
    const result = await env.DB.prepare(
      'DELETE FROM ilo_cards WHERE user_id = ?1 AND id = ?2',
    ).bind(session.userId, cardId).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Card was not found.' }, 404);
    return json(await mutationPayload(env, session.userId, null));
  } catch (error) {
    return failure('delete card', error);
  }
}

export async function iloDeleteCards(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readJson(request);
    const cardIds = Array.isArray(input.cardIds)
      ? [...new Set(input.cardIds.filter((value): value is string => typeof value === 'string'))]
      : [];
    if (cardIds.length === 0 || cardIds.length > MAX_DELETE_CARDS || cardIds.some((id) => !validCardId(id))) {
      return json({ error: 'Card selection is invalid.' }, 400);
    }
    const placeholders = cardIds.map((_, index) => `?${index + 2}`).join(', ');
    const result = await env.DB.prepare(
      `DELETE FROM ilo_cards WHERE user_id = ?1 AND id IN (${placeholders})`,
    ).bind(session.userId, ...cardIds).run();
    const payload = await mutationPayload(env, session.userId, null);
    return json({ ...payload, deleted: Number(result.meta.changes ?? 0) });
  } catch (error) {
    return failure('delete cards', error);
  }
}

export async function iloTrainNext(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    return json(await trainFor(env, session.userId));
  } catch (error) {
    return failure('next training card', error);
  }
}

export async function iloGrade(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readJson(request);
    const cardId = typeof input.cardId === 'string' ? input.cardId : '';
    const action = input.action === 'remember' || input.action === 'forgot' ? input.action : null;
    if (!validCardId(cardId) || !action) return json({ error: 'Training grade is invalid.' }, 400);
    const now = unixNow();
    const day = localDate(now);
    const remembered = action === 'remember' ? 1 : 0;
    const [gradeResult] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE ilo_cards
            SET stage = CASE WHEN ?3 = 1 THEN MIN(8, stage + 1) ELSE MAX(0, stage - 1) END,
                next_review_at = CASE
                  WHEN ?3 = 1 THEN ?4 + CASE MIN(8, stage + 1)
                    WHEN 1 THEN ?5 WHEN 2 THEN ?6 WHEN 3 THEN ?7 WHEN 4 THEN ?8
                    WHEN 5 THEN ?9 WHEN 6 THEN ?10 WHEN 7 THEN ?11 ELSE ?12 END
                  ELSE ?4 + CASE WHEN stage <= 1 THEN 120 ELSE 600 END
                END,
                failure_count = failure_count + CASE WHEN ?3 = 1 THEN 0 ELSE 1 END,
                updated_at = ?4
          WHERE user_id = ?1 AND id = ?2`,
      ).bind(
        session.userId, cardId, remembered, now,
        ILO_SRS_SECONDS[1], ILO_SRS_SECONDS[2], ILO_SRS_SECONDS[3], ILO_SRS_SECONDS[4],
        ILO_SRS_SECONDS[5], ILO_SRS_SECONDS[6], ILO_SRS_SECONDS[7], ILO_SRS_SECONDS[8],
      ),
      env.DB.prepare(
        `INSERT INTO ilo_profiles(user_id, onboarded, last_study_date, updated_at)
         SELECT ?1, 1, ?3, ?4 WHERE EXISTS (
           SELECT 1 FROM ilo_cards WHERE user_id = ?1 AND id = ?2
         )
         ON CONFLICT(user_id) DO UPDATE SET onboarded = 1,
           last_study_date = excluded.last_study_date, updated_at = excluded.updated_at`,
      ).bind(session.userId, cardId, day, now),
      env.DB.prepare(
        `INSERT INTO ilo_daily_points(user_id, day, points)
         SELECT ?1, ?3, 1 WHERE EXISTS (
           SELECT 1 FROM ilo_cards WHERE user_id = ?1 AND id = ?2
         )
         ON CONFLICT(user_id, day) DO UPDATE SET points = points + 1`,
      ).bind(session.userId, cardId, day),
    ]);
    if ((gradeResult.meta.changes ?? 0) === 0) return json({ error: 'Card was not found.' }, 404);
    return json(await mutationPayload(env, session.userId, null));
  } catch (error) {
    return failure('grade card', error);
  }
}

export async function iloProgress(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    return json(await progressFor(env, session.userId));
  } catch (error) {
    return failure('progress', error);
  }
}

async function overviewFor(env: Env, userId: ArrayBuffer) {
  const now = unixNow();
  const [profileResult, cardResult, summaryResult, stagesResult, pointsResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT native_label, onboarded, task_cursor, last_study_date
         FROM ilo_profiles WHERE user_id = ?1 LIMIT 1`,
    ).bind(userId),
    dueCardStatement(env, userId, now),
    summaryStatement(env, userId, now),
    stagesStatement(env, userId),
    pointsStatement(env, userId),
  ]);
  const profile = firstRow<ProfileRow>(profileResult);
  const card = firstRow<CardRow>(cardResult);
  const summary = firstRow<SummaryRow>(summaryResult) ?? { active: 0, due: 0 };
  return {
    profile,
    progress: progressPayload(summary, rows<StageRow>(stagesResult), rows<PointRow>(pointsResult), now),
    train: trainPayload(card, summary, profile?.native_label ?? 'russian'),
  };
}

async function trainFor(env: Env, userId: ArrayBuffer) {
  const now = unixNow();
  const [profileResult, cardResult, summaryResult] = await env.DB.batch([
    env.DB.prepare('SELECT native_label FROM ilo_profiles WHERE user_id = ?1 LIMIT 1').bind(userId),
    dueCardStatement(env, userId, now),
    summaryStatement(env, userId, now),
  ]);
  const profile = firstRow<Pick<ProfileRow, 'native_label'>>(profileResult);
  return trainPayload(
    firstRow<CardRow>(cardResult),
    firstRow<SummaryRow>(summaryResult) ?? { active: 0, due: 0 },
    profile?.native_label ?? 'russian',
  );
}

async function progressFor(env: Env, userId: ArrayBuffer): Promise<Progress> {
  const now = unixNow();
  const [summaryResult, stagesResult, pointsResult] = await env.DB.batch([
    summaryStatement(env, userId, now),
    stagesStatement(env, userId),
    pointsStatement(env, userId),
  ]);
  return progressPayload(
    firstRow<SummaryRow>(summaryResult) ?? { active: 0, due: 0 },
    rows<StageRow>(stagesResult),
    rows<PointRow>(pointsResult),
    now,
  );
}

function dueCardStatement(env: Env, userId: ArrayBuffer, now: number) {
  return env.DB.prepare(
    `SELECT id, german, translation, theme, article, plural, example, note,
            stage, next_review_at, failure_count, created_at, updated_at
       FROM ilo_cards
      WHERE user_id = ?1 AND next_review_at <= ?2
      ORDER BY next_review_at ASC, id ASC LIMIT 1`,
  ).bind(userId, now);
}

function summaryStatement(env: Env, userId: ArrayBuffer, now: number) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS active,
            COALESCE(SUM(CASE WHEN next_review_at <= ?2 THEN 1 ELSE 0 END), 0) AS due
       FROM ilo_cards WHERE user_id = ?1`,
  ).bind(userId, now);
}

function stagesStatement(env: Env, userId: ArrayBuffer) {
  return env.DB.prepare(
    'SELECT stage, COUNT(*) AS count FROM ilo_cards WHERE user_id = ?1 GROUP BY stage',
  ).bind(userId);
}

function pointsStatement(env: Env, userId: ArrayBuffer) {
  return env.DB.prepare(
    'SELECT day, points FROM ilo_daily_points WHERE user_id = ?1 ORDER BY day DESC LIMIT 14',
  ).bind(userId);
}

function trainPayload(card: CardRow | null, summary: SummaryRow, nativeLabel: string) {
  return {
    active: Number(summary.active ?? 0),
    card: card ? buildTrainingCard(card, nativeLabel) : null,
    due: Number(summary.due ?? 0),
  };
}

function progressPayload(summary: SummaryRow, stageRows: StageRow[], pointRows: PointRow[], now: number): Progress {
  const stages: Record<string, number> = {};
  for (let stage = 0; stage <= 8; stage += 1) stages[String(stage)] = 0;
  for (const row of stageRows) stages[String(row.stage)] = Number(row.count ?? 0);
  const points = new Map(pointRows.map((row) => [row.day, Number(row.points ?? 0)]));
  const pointsHistory = Array.from({ length: 7 }, (_, index) => {
    const date = localDate(now - (6 - index) * 86_400);
    return { date, points: points.get(date) ?? 0 };
  });
  const todayPoints = points.get(localDate(now)) ?? 0;
  return {
    active: Number(summary.active ?? 0),
    due: Number(summary.due ?? 0),
    learnedToday: todayPoints > 0,
    pointsHistory,
    stages,
    todayPoints,
  };
}

async function mutationPayload(env: Env, userId: ArrayBuffer, card: unknown) {
  return mutationFromOverview(await overviewFor(env, userId), card);
}

function mutationFromOverview(overview: Awaited<ReturnType<typeof overviewFor>>, card: unknown) {
  return { card, progress: overview.progress, train: overview.train };
}

async function cardInput(request: Request): Promise<CardInput> {
  const input = await readJson(request);
  return {
    article: optionalText(input.article, 64),
    example: optionalText(input.example, 512),
    german: requiredText(input.german, 256, 'German word'),
    note: optionalText(input.note, 512),
    plural: optionalText(input.plural, 256),
    theme: normalizeTheme(typeof input.theme === 'string' ? input.theme : '') || 'other',
    translation: requiredText(input.translation, 512, 'Translation'),
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new IloInputError('Content-Type must be application/json.');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new IloInputError('Ilo request is too large.');
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new IloInputError('Invalid JSON.');
  }
}

function cardPayload(row: CardRow) {
  return {
    article: row.article,
    createdAt: row.created_at,
    example: row.example,
    failureCount: row.failure_count,
    german: row.german,
    id: row.id,
    nextReviewAt: row.next_review_at,
    note: row.note,
    plural: row.plural,
    stage: row.stage,
    theme: row.theme,
    translation: row.translation,
    updatedAt: row.updated_at,
  };
}

function requiredText(value: unknown, max: number, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw new IloInputError(`${label} is invalid.`);
  return text;
}

function optionalText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) throw new IloInputError('One of the card fields is too long.');
  return text;
}

function normalizeTheme(value: string): string {
  const theme = value.trim().toLowerCase();
  return THEMES.has(theme) ? theme : '';
}

function normalizeSearch(value: string): string {
  return value.trim().slice(0, MAX_SEARCH);
}

function boundedInteger(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
}

function validCardId(value: string): boolean {
  return /^[0-9a-f]{8,32}$/u.test(value);
}

function localDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin', year: 'numeric',
  }).formatToParts(new Date(timestamp * 1_000));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function rows<T>(result: D1Result<unknown>): T[] {
  return result.results as T[];
}

function firstRow<T>(result: D1Result<unknown>): T | null {
  return rows<T>(result)[0] ?? null;
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function failure(operation: string, error: unknown): Response {
  const message = error instanceof IloInputError
    ? error.message
    : error instanceof Error && error.message.trim() ? error.message : 'Lingvolernado is unavailable.';
  if (!(error instanceof IloInputError)) console.error(`[ilo] ${operation}`, error);
  return json({ error: message }, error instanceof IloInputError ? 400 : 500);
}

class IloInputError extends Error {}
