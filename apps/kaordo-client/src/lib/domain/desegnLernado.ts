export const DESEGN_FOCUSES = [
  'gesture',
  'anatomy',
  'form',
  'perspective',
  'value',
  'colour',
  'composition',
  'materials',
  'environment',
  'character',
  'other',
] as const;

export type DesegnFocus = typeof DESEGN_FOCUSES[number];
export type DesegnPetPalette = 'ink' | 'mint' | 'sunset' | 'night';
export type DesegnReviewOutcome = 'keep-working' | 'progress-visible';

export type DesegnDrawing = {
  byteSize: number;
  createdAt: number;
  description: string;
  fileName: string;
  focus: DesegnFocus;
  height: number;
  id: string;
  lastReviewedAt: number | null;
  mimeType: string;
  nextReviewAt: number;
  rating: number | null;
  reviewCount: number;
  shortcomings: string[];
  title: string;
  updatedAt: number;
  width: number;
};

export type DesegnDrawingPatch = Pick<
  DesegnDrawing,
  'description' | 'focus' | 'rating' | 'shortcomings' | 'title'
>;

export type DesegnPetProfile = {
  equippedArtifactIds: Array<string | null>;
  name: string;
  palette: DesegnPetPalette;
};

export type DesegnLernadoSnapshot = {
  busy: string | null;
  drawings: DesegnDrawing[];
  error: string | null;
  pet: DesegnPetProfile;
  phase: 'idle' | 'loading' | 'ready';
};

export const EMPTY_DESEGN_PET: DesegnPetProfile = {
  equippedArtifactIds: [null, null, null],
  name: 'Moki',
  palette: 'ink',
};

export const EMPTY_DESEGN_LERNADO: DesegnLernadoSnapshot = {
  busy: null,
  drawings: [],
  error: null,
  pet: { ...EMPTY_DESEGN_PET, equippedArtifactIds: [...EMPTY_DESEGN_PET.equippedArtifactIds] },
  phase: 'idle',
};
