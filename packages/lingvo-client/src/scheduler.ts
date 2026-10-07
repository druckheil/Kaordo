// Adapts saved FSRS-6 cards to deterministic ts-fsrs previews loaded only during practice
import { createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs';
import type { LingvoSchedule } from '@kaordo/contracts';

const scheduler = fsrs({ request_retention: 0.9, maximum_interval: 36500, enable_fuzz: false,
  enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] });

export function reviewIntervals(schedule: LingvoSchedule, now = new Date()): Record<Grade, string> {
  const card: Card = { ...createEmptyCard(now), due: new Date(schedule.due), stability: schedule.stability,
    difficulty: schedule.difficulty, scheduled_days: schedule.scheduledDays, reps: schedule.reps,
    lapses: schedule.lapses, state: schedule.state, learning_steps: schedule.learningSteps,
    last_review: schedule.lastReview ? new Date(schedule.lastReview) : undefined };
  const preview = scheduler.repeat(card, now);
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
