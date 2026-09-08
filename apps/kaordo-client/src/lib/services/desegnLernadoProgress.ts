import {
  DESEGN_FOCUSES,
  type DesegnDrawing,
  type DesegnFocus,
  type DesegnPetProfile,
  type DesegnReviewOutcome,
} from '../domain/desegnLernado';

export type DesegnStats = {
  averageRating: number | null;
  describedDrawings: number;
  dueReviews: number;
  focusCounts: Record<DesegnFocus, number>;
  ratedDrawings: number;
  totalDrawings: number;
  totalReviews: number;
  totalShortcomings: number;
  uploadStreak: number;
  uploadedThisWeek: number;
};

export type DesegnArtifactRarity = 'common' | 'rare' | 'epic';

export type DesegnArtifact = {
  accent: string;
  description: string;
  drill: string;
  glyph: string;
  id: string;
  metric: keyof Omit<DesegnStats, 'averageRating' | 'focusCounts'> | `focus:${DesegnFocus}` | 'rated';
  name: string;
  rarity: DesegnArtifactRarity;
  threshold: number;
};

const DAY_MS = 86_400_000;

export const DESEGN_ARTIFACTS: readonly DesegnArtifact[] = [
  { id: 'first-mark', name: 'First Mark', glyph: '✦', rarity: 'common', accent: '#7a68e8', metric: 'totalDrawings', threshold: 1, description: 'The studio remembers the moment you began.', drill: 'Draw one object using only five decisive lines.' },
  { id: 'honest-mirror', name: 'Honest Mirror', glyph: '◇', rarity: 'common', accent: '#e07883', metric: 'totalShortcomings', threshold: 3, description: 'Clear observation turns mistakes into directions.', drill: 'Choose one weakness and redraw only that fragment.' },
  { id: 'revision-loop', name: 'Revision Loop', glyph: '↻', rarity: 'common', accent: '#36a98b', metric: 'totalReviews', threshold: 1, description: 'Looking again is part of making, not an afterthought.', drill: 'Revisit an old drawing and name one visible improvement.' },
  { id: 'gesture-bell', name: 'Gesture Bell', glyph: '∿', rarity: 'rare', accent: '#ef8a58', metric: 'focus:gesture', threshold: 3, description: 'A quick line can carry an entire pose.', drill: 'Make six 30-second gestures without erasing.' },
  { id: 'form-stone', name: 'Form Stone', glyph: '⬡', rarity: 'rare', accent: '#6687d8', metric: 'focus:form', threshold: 3, description: 'Simple volumes hold complicated subjects together.', drill: 'Reduce a subject to boxes, spheres, and cylinders.' },
  { id: 'angle-lens', name: 'Angle Lens', glyph: '⌁', rarity: 'rare', accent: '#4ba5ba', metric: 'focus:perspective', threshold: 3, description: 'Angles stop hiding when you compare them deliberately.', drill: 'Draw the same box from three eye levels.' },
  { id: 'value-prism', name: 'Value Prism', glyph: '◐', rarity: 'rare', accent: '#766ed0', metric: 'focus:value', threshold: 3, description: 'Light becomes readable when values become intentional.', drill: 'Paint a study using only three values.' },
  { id: 'colour-bloom', name: 'Colour Bloom', glyph: '❋', rarity: 'rare', accent: '#d766a8', metric: 'focus:colour', threshold: 3, description: 'Colour relationships matter more than isolated swatches.', drill: 'Build a scene from one dominant and one accent colour.' },
  { id: 'anatomy-thread', name: 'Anatomy Thread', glyph: '⌇', rarity: 'rare', accent: '#d48661', metric: 'focus:anatomy', threshold: 3, description: 'Structure connects every landmark of the body.', drill: 'Trace the line of action, rib cage, and pelvis first.' },
  { id: 'composition-key', name: 'Composition Key', glyph: '▦', rarity: 'rare', accent: '#5d9c75', metric: 'focus:composition', threshold: 3, description: 'A clear hierarchy gives the eye somewhere to travel.', drill: 'Make nine tiny thumbnails before choosing a composition.' },
  { id: 'material-shell', name: 'Material Shell', glyph: '◈', rarity: 'rare', accent: '#9a7a58', metric: 'focus:materials', threshold: 3, description: 'Edges and reflections explain what a surface is made of.', drill: 'Render metal, glass, and cloth under the same light.' },
  { id: 'story-seed', name: 'Story Seed', glyph: '❖', rarity: 'rare', accent: '#5f8fbb', metric: 'focus:character', threshold: 3, description: 'A character becomes memorable through a readable choice.', drill: 'Design three silhouettes for the same personality.' },
  { id: 'critic-lantern', name: 'Critic Lantern', glyph: '◉', rarity: 'epic', accent: '#e1a53a', metric: 'describedDrawings', threshold: 10, description: 'Notes preserve the lesson hidden inside every drawing.', drill: 'Write what worked before writing what failed.' },
  { id: 'studio-rhythm', name: 'Studio Rhythm', glyph: '♫', rarity: 'epic', accent: '#4ba77f', metric: 'uploadStreak', threshold: 5, description: 'Five days of marks have made the studio feel alive.', drill: 'Keep today tiny: finish one deliberate ten-minute study.' },
  { id: 'archive-star', name: 'Archive Star', glyph: '★', rarity: 'epic', accent: '#8a68d6', metric: 'totalDrawings', threshold: 25, description: 'A body of work reveals changes that a single image cannot.', drill: 'Compare your first and latest drawing of one subject.' },
  { id: 'revisit-crown', name: 'Revisit Crown', glyph: '♢', rarity: 'epic', accent: '#d19444', metric: 'totalReviews', threshold: 20, description: 'Repeated reflection has become part of your craft.', drill: 'Redo an old study without looking at its notes first.' },
  { id: 'clear-eye', name: 'Clear Eye', glyph: '⊙', rarity: 'epic', accent: '#517fc2', metric: 'rated', threshold: 15, description: 'Consistent self-rating makes progress easier to see.', drill: 'Score silhouette, structure, and finish separately.' },
  { id: 'fifty-pages', name: 'Fifty Pages', glyph: '✺', rarity: 'epic', accent: '#be6578', metric: 'totalDrawings', threshold: 50, description: 'Fifty saved drawings form a visible path through practice.', drill: 'Recreate drawing number one with what you know now.' },
] as const;

export const BASE_DRAWING_PROMPTS = [
  'Draw a familiar object from an unfamiliar angle.',
  'Use one large, one medium, and one small shape.',
  'Make a ten-minute study without using an eraser.',
  'Draw the negative space around the subject first.',
  'Turn a photograph into three simple value groups.',
  'Repeat yesterday’s subject with one deliberate change.',
  'Draw from memory, then compare against the reference.',
  'Make four tiny compositions before the final sketch.',
] as const;

export function desegnStats(drawings: readonly DesegnDrawing[], now = Date.now()): DesegnStats {
  const focusCounts = Object.fromEntries(DESEGN_FOCUSES.map((focus) => [focus, 0])) as Record<DesegnFocus, number>;
  let totalReviews = 0;
  let totalShortcomings = 0;
  let describedDrawings = 0;
  let dueReviews = 0;
  let ratingTotal = 0;
  let rated = 0;
  let uploadedThisWeek = 0;
  for (const drawing of drawings) {
    focusCounts[drawing.focus] += 1;
    totalReviews += drawing.reviewCount;
    totalShortcomings += drawing.shortcomings.length;
    if (drawing.description.trim()) describedDrawings += 1;
    if (drawing.nextReviewAt <= now) dueReviews += 1;
    if (drawing.createdAt >= now - 7 * DAY_MS) uploadedThisWeek += 1;
    if (drawing.rating !== null) {
      ratingTotal += drawing.rating;
      rated += 1;
    }
  }
  return {
    averageRating: rated ? ratingTotal / rated : null,
    describedDrawings,
    dueReviews,
    focusCounts,
    ratedDrawings: rated,
    totalDrawings: drawings.length,
    totalReviews,
    totalShortcomings,
    uploadStreak: uploadStreak(drawings, now),
    uploadedThisWeek,
  };
}

export function artifactProgress(artifact: DesegnArtifact, stats: DesegnStats): number {
  if (artifact.metric.startsWith('focus:')) {
    return stats.focusCounts[artifact.metric.slice(6) as DesegnFocus];
  }
  if (artifact.metric === 'rated') {
    return stats.ratedDrawings;
  }
  const value = stats[artifact.metric as keyof DesegnStats];
  return typeof value === 'number' ? value : 0;
}

export function unlockedDesegnArtifacts(stats: DesegnStats): DesegnArtifact[] {
  return DESEGN_ARTIFACTS.filter((artifact) => artifactProgress(artifact, stats) >= artifact.threshold);
}

export function nextDesegnArtifact(stats: DesegnStats): DesegnArtifact | null {
  return DESEGN_ARTIFACTS
    .filter((artifact) => artifactProgress(artifact, stats) < artifact.threshold)
    .sort((left, right) => {
      const leftRatio = artifactProgress(left, stats) / left.threshold;
      const rightRatio = artifactProgress(right, stats) / right.threshold;
      return rightRatio - leftRatio || left.threshold - right.threshold;
    })[0] ?? null;
}

export function desegnPracticePrompt(profile: Readonly<DesegnPetProfile>, stats: DesegnStats, now = Date.now()): string {
  const equipped = profile.equippedArtifactIds
    .flatMap((id) => DESEGN_ARTIFACTS.find((artifact) => artifact.id === id) ?? []);
  const pool = equipped.length > 0 ? equipped.map((artifact) => artifact.drill) : [...BASE_DRAWING_PROMPTS];
  const day = Math.floor(now / DAY_MS);
  return pool[(day + stats.totalDrawings + stats.totalReviews) % pool.length]!;
}

export function reviewedDrawing(
  drawing: Readonly<DesegnDrawing>,
  outcome: DesegnReviewOutcome,
  now = Date.now(),
): DesegnDrawing {
  const reviewCount = drawing.reviewCount + 1;
  const intervals = outcome === 'keep-working' ? [1, 2, 3] : [3, 7, 14, 30, 60];
  const intervalDays = intervals[Math.min(reviewCount - 1, intervals.length - 1)]!;
  return {
    ...drawing,
    lastReviewedAt: now,
    nextReviewAt: now + intervalDays * DAY_MS,
    reviewCount,
    updatedAt: now,
  };
}

function uploadStreak(drawings: readonly DesegnDrawing[], now: number): number {
  const days = new Set(drawings.map((drawing) => localDay(drawing.createdAt)));
  if (days.size === 0) return 0;
  const cursor = new Date(startOfLocalDay(now));
  if (!days.has(localDay(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function startOfLocalDay(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDay(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
