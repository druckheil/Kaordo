import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_DESEGN_LERNADO, type DesegnDrawing } from '../../lib/domain/desegnLernado';
import type { IloGState } from '../../lib/states/IloGState';
import DesegnLernadoSection from './DesegnLernadoSection.svelte';

function studioState(): IloGState {
  return {
    clearDesegnError: vi.fn(),
    deleteDesegnDrawing: vi.fn(),
    desegnLernadoMediaUrl: vi.fn().mockResolvedValue(null),
    equipDesegnArtifact: vi.fn(),
    loadDesegnLernado: vi.fn(),
    renameDesegnPet: vi.fn(),
    reviewDesegnDrawing: vi.fn(),
    setDesegnPetPalette: vi.fn(),
    updateDesegnDrawing: vi.fn(),
  } as unknown as IloGState;
}

function drawing(): DesegnDrawing {
  return {
    byteSize: 10,
    createdAt: 1,
    description: '',
    fileName: 'study.png',
    focus: 'form',
    height: 100,
    id: 'study',
    lastReviewedAt: null,
    mimeType: 'image/png',
    nextReviewAt: 2,
    rating: null,
    reviewCount: 0,
    shortcomings: [],
    title: 'Study',
    updatedAt: 1,
    width: 100,
  };
}

describe('DesegnLernado studio', () => {
  it('keeps its gallery primary and mounts one focused room at a time', async () => {
    const state = studioState();
    const snapshot = structuredClone(EMPTY_DESEGN_LERNADO);
    snapshot.phase = 'ready';
    const view = render(DesegnLernadoSection, { snapshot, state });

    expect(state.loadDesegnLernado).toHaveBeenCalledWith(false);
    expect(view.getByRole('heading', { name: 'DesegnLernado' })).toBeTruthy();
    expect(view.getByRole('heading', { name: 'Drop a drawing into the studio' })).toBeTruthy();

    await fireEvent.click(view.getByRole('button', { name: 'Companion: Studio guide' }));
    expect(view.getByRole('heading', { name: 'A creature made of marks' })).toBeTruthy();
    expect(view.queryByRole('heading', { name: 'Drop a drawing into the studio' })).toBeNull();

    await fireEvent.click(view.getByRole('button', { name: 'Artifacts: Unlock drills' }));
    expect(view.getByRole('heading', { name: 'Every artifact changes what you draw next' })).toBeTruthy();

    await fireEvent.click(view.getByRole('button', { name: 'Insights: See patterns' }));
    expect(view.getByRole('heading', { name: 'Patterns hiding in your archive' })).toBeTruthy();
  });

  it('fills every star up to the selected rating', async () => {
    const state = studioState();
    const snapshot = structuredClone(EMPTY_DESEGN_LERNADO);
    snapshot.phase = 'ready';
    snapshot.drawings = [drawing()];
    const view = render(DesegnLernadoSection, { snapshot, state });

    await fireEvent.click(view.getByRole('button', { name: 'Edit notes for Study' }));
    await fireEvent.click(view.getByRole('button', { name: 'Rate 3 out of 5' }));

    for (const value of [1, 2, 3]) {
      expect(view.getByRole('button', { name: `Rate ${value} out of 5` })).toHaveAttribute('aria-pressed', 'true');
    }
    for (const value of [4, 5]) {
      expect(view.getByRole('button', { name: `Rate ${value} out of 5` })).toHaveAttribute('aria-pressed', 'false');
    }
  });
});
