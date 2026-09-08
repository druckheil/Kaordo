import { describe, expect, it } from 'vitest';
import type { DesegnDrawing } from '../domain/desegnLernado';
import {
  artifactProgress,
  desegnStats,
  reviewedDrawing,
  unlockedDesegnArtifacts,
} from './desegnLernadoProgress';

function drawing(overrides: Partial<DesegnDrawing> = {}): DesegnDrawing {
  return {
    byteSize: 100,
    createdAt: new Date(2026, 8, 8, 12).getTime(),
    description: '',
    fileName: 'study.png',
    focus: 'other',
    height: 600,
    id: 'drawing-1',
    lastReviewedAt: null,
    mimeType: 'image/png',
    nextReviewAt: new Date(2026, 8, 9, 12).getTime(),
    rating: null,
    reviewCount: 0,
    shortcomings: [],
    title: 'Study',
    updatedAt: new Date(2026, 8, 8, 12).getTime(),
    width: 800,
    ...overrides,
  };
}

describe('DesegnLernado progress', () => {
  it('derives honest local metrics and unlocks artifacts from concrete work', () => {
    const now = new Date(2026, 8, 10, 12).getTime();
    const drawings = [
      drawing({ description: 'Gesture study', focus: 'gesture', id: '1', nextReviewAt: now - 1, rating: 4, shortcomings: ['Hands', 'Balance'] }),
      drawing({ createdAt: now - 86_400_000, focus: 'gesture', id: '2', nextReviewAt: now + 1, rating: 3, shortcomings: ['Hands'] }),
      drawing({ createdAt: now, focus: 'gesture', id: '3', nextReviewAt: now + 1, rating: 5, reviewCount: 1, shortcomings: ['Line weight'] }),
    ];

    const stats = desegnStats(drawings, now);
    expect(stats).toMatchObject({
      averageRating: 4,
      describedDrawings: 1,
      dueReviews: 1,
      ratedDrawings: 3,
      totalDrawings: 3,
      totalReviews: 1,
      totalShortcomings: 4,
      uploadStreak: 3,
    });
    expect(stats.focusCounts.gesture).toBe(3);
    expect(unlockedDesegnArtifacts(stats).map((artifact) => artifact.id)).toEqual(expect.arrayContaining([
      'first-mark', 'honest-mirror', 'revision-loop', 'gesture-bell',
    ]));
    expect(artifactProgress({
      accent: '', description: '', drill: '', glyph: '', id: '', metric: 'rated', name: '', rarity: 'common', threshold: 1,
    }, stats)).toBe(3);
  });

  it('schedules honest retries sooner than visible progress', () => {
    const now = new Date(2026, 8, 10, 12).getTime();
    const retry = reviewedDrawing(drawing(), 'keep-working', now);
    const progress = reviewedDrawing(drawing(), 'progress-visible', now);

    expect(retry.reviewCount).toBe(1);
    expect(retry.nextReviewAt).toBe(now + 86_400_000);
    expect(progress.nextReviewAt).toBe(now + 3 * 86_400_000);
  });
});
