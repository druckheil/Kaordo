// Defines encrypted calendar documents and local task categories
import { z } from 'zod';
import { documentPlainText, documentSchema, type FluoDocument } from '@kaordo/contracts';
import { emptyDocument } from '@kaordo/editor-ui';
import type { MediaAttachment } from '@kaordo/media-ui';

export const categories = [
  { id: 'personal', name: 'Personal', color: '#a78bfa' },
  { id: 'work', name: 'Work', color: '#60a5fa' },
  { id: 'health', name: 'Health', color: '#34d399' },
  { id: 'learning', name: 'Learning', color: '#fbbf24' },
  { id: 'other', name: 'Other', color: '#fb7185' }
] as const;
export type Category = typeof categories[number]['id'];
export type TaskStatus = '' | 'planned' | 'in-progress' | 'done';
export interface StoredMedia extends Omit<MediaAttachment, 'url' | 'loadURL'> { nonce: string; context: string }
export interface Entry { content: FluoDocument; media: StoredMedia[] }
export interface Task extends Entry { id: string; category: Category; status: TaskStatus; time: string }
export interface DayDocument { version: 1; date: string; tasks: Task[]; journal: Entry }
export interface DaySummary { date: string; colors: string[]; hasJournal: boolean }
export function emptyDay(date: string): DayDocument { return { version: 1, date, tasks: [], journal: { content: emptyDocument(), media: [] } }; }
export function emptyTask(): Task { return { id: crypto.randomUUID(), category: 'personal', status: '', time: '', content: emptyDocument(), media: [] }; }
export { documentPlainText as documentText } from '@kaordo/contracts';
export function summarize(day: DayDocument): DaySummary {
  return { date: day.date, colors: day.tasks.map(task => categories.find(category => category.id === task.category)?.color ?? '#fb7185'),
    hasJournal: !!documentPlainText(day.journal.content) || day.journal.media.length > 0 };
}
export function dayAttachments(day: DayDocument): StoredMedia[] { return [...day.tasks.flatMap(task => task.media), ...day.journal.media]; }
const storedMedia = z.strictObject({
  id: z.uuid(), kind: z.enum(['image', 'video']), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']),
  width: z.number().int().min(1).max(100000), height: z.number().int().min(1).max(100000),
  size: z.number().int().min(1).max(99 * 1024 * 1024), altText: z.string().max(1000),
  nonce: z.base64().length(16), context: z.string().regex(/^\d{4}-\d{2}-\d{2}\/media\/[0-9a-f-]{36}$/)
}).refine(value => value.mimeType.startsWith(value.kind + '/'));
const entry = { content: documentSchema, media: z.array(storedMedia).max(4) };
const task = z.strictObject({ ...entry, id: z.uuid(), category: z.enum(['personal', 'work', 'health', 'learning', 'other']),
  status: z.enum(['', 'planned', 'in-progress', 'done']), time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/) });
const daySchema = z.strictObject({ version: z.literal(1), date: z.iso.date(), tasks: z.array(task).max(200), journal: z.strictObject(entry) });
export function validateDay(value: unknown, date: string): DayDocument {
  const parsed = daySchema.safeParse(value);
  if (!parsed.success || parsed.data.date !== date) throw new Error('The encrypted day is damaged or uses an unsupported format.');
  const document = parsed.data as DayDocument;
  const media = dayAttachments(document);
  if (media.length > 32 || new Set(media.map(item => item.id)).size !== media.length ||
      new Set(document.tasks.map(item => item.id)).size !== document.tasks.length ||
      media.some(item => !item.context.startsWith(`${date}/media/`)) ||
      [document.journal, ...document.tasks].some(item => documentPlainText(item.content).length > 100000))
    throw new Error('The day exceeds its limits or contains duplicate entries.');
  return document;
}
export function validateSummary(value: unknown): DaySummary {
  const parsed = z.strictObject({ date: z.iso.date(), colors: z.array(z.enum(categories.map(item => item.color))).max(200), hasJournal: z.boolean() }).safeParse(value);
  if (!parsed.success) throw new Error('The encrypted calendar summary is damaged.');
  return parsed.data;
}
