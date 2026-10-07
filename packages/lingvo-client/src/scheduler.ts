// Adapts saved FSRS-6 cards to deterministic ts-fsrs previews loaded only during practice
import { createEmptyCard, date_scheduler, fsrs, type Card, type Grade, type IPreview } from 'ts-fsrs';
import type { LingvoSchedule } from '@kaordo/contracts';

const maximumInterval = 36500;
const scheduler = fsrs({ request_retention: 0.9, maximum_interval: maximumInterval, enable_fuzz: false,
  enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] });

export function reviewPreviews(schedule: LingvoSchedule, now = new Date()): IPreview {
  const card: Card = { ...createEmptyCard(now), due: new Date(schedule.due), stability: schedule.stability,
    difficulty: schedule.difficulty, scheduled_days: schedule.scheduledDays, reps: schedule.reps,
    lapses: schedule.lapses, state: schedule.state, learning_steps: schedule.learningSteps,
    last_review: schedule.lastReview ? new Date(schedule.lastReview) : undefined };
  const preview = scheduler.repeat(card, now);
  // Upstream grade ordering can add days past the configured cap after saturation
  for (const result of preview) {
    if (result.card.scheduled_days > maximumInterval) {
      result.card.scheduled_days = maximumInterval;
      result.card.due = date_scheduler(now, maximumInterval, true);
    }
  }
  return preview;
}

export function reviewIntervals(schedule: LingvoSchedule, now = new Date()): Record<Grade, string> {
  const preview = reviewPreviews(schedule, now);
  return { 1: intervalLabel(preview[1].card.due, now), 2: intervalLabel(preview[2].card.due, now),
    3: intervalLabel(preview[3].card.due, now), 4: intervalLabel(preview[4].card.due, now) };
}

function intervalLabel(due: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return minutes + 'm';
  if (minutes < 1440) return Math.round(minutes / 60) + 'h';
  const days = Math.max(1, Math.round(minutes / 1440));
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return Math.round(days / 365) + 'y';
}
