import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesegnDrawing } from '../domain/desegnLernado';
import type { IloGateway } from '../gateways/IloGateway';
import { MemoryDesegnLernadoStore } from '../services/DesegnLernadoStore';
import { IloGState } from './IloGState';

function drawing(id: string): DesegnDrawing {
  return {
    byteSize: 4,
    createdAt: 100,
    description: '',
    fileName: `${id}.png`,
    focus: 'other',
    height: 1,
    id,
    lastReviewedAt: null,
    mimeType: 'image/png',
    nextReviewAt: 0,
    rating: null,
    reviewCount: 0,
    shortcomings: [],
    title: id,
    updatedAt: 100,
    width: 1,
  };
}

describe('IloGState DesegnLernado archive', () => {
  beforeEach(() => localStorage.clear());

  it('keeps drawing media isolated by account', async () => {
    const store = new MemoryDesegnLernadoStore();
    const original = new Blob(['one'], { type: 'image/png' });
    const thumbnail = new Blob(['tiny'], { type: 'image/webp' });
    await store.saveDrawing('owner-1', drawing('same-id'), original, thumbnail);
    await store.saveDrawing('owner-2', { ...drawing('same-id'), title: 'Other owner' }, new Blob(['two']), thumbnail);

    expect((await store.load('owner-1')).drawings[0]?.title).toBe('same-id');
    expect((await store.load('owner-2')).drawings[0]?.title).toBe('Other owner');
    expect(await (await store.loadMedia('owner-1', 'same-id', 'original'))?.text()).toBe('one');
    expect(await (await store.loadMedia('owner-2', 'same-id', 'original'))?.text()).toBe('two');
  });

  it('persists reflections, review movement, and companion artifacts through one state owner', async () => {
    const store = new MemoryDesegnLernadoStore();
    await store.saveDrawing('owner-1', drawing('study'), new Blob(['full']), new Blob(['preview']));
    const state = new IloGState({} as IloGateway, store);
    state.configure('owner-1');
    await state.loadDesegnLernado();

    expect(state.snapshot.desegnLernado.drawings).toHaveLength(1);
    expect(await state.updateDesegnDrawing('study', {
      description: '  Structure is clearer.  ',
      focus: 'form',
      rating: 8,
      shortcomings: ['  Flat hands ', 'Flat hands', '', 'Edges'],
      title: '  Box study  ',
    })).toBe(true);
    expect(state.snapshot.desegnLernado.drawings[0]).toMatchObject({
      description: 'Structure is clearer.',
      focus: 'form',
      rating: 5,
      shortcomings: ['Flat hands', 'Edges'],
      title: 'Box study',
    });

    expect(await state.reviewDesegnDrawing('study', 'progress-visible')).toBe(true);
    expect(state.snapshot.desegnLernado.drawings[0]?.reviewCount).toBe(1);
    expect(await state.equipDesegnArtifact('first-mark', 1)).toBe(true);
    expect(state.snapshot.desegnLernado.pet.equippedArtifactIds).toEqual([null, 'first-mark', null]);
    expect((await store.load('owner-1')).pet.equippedArtifactIds).toEqual([null, 'first-mark', null]);

    expect(await state.deleteDesegnDrawing('study')).toBe(true);
    expect(state.snapshot.desegnLernado.drawings).toHaveLength(0);
    expect(await store.loadMedia('owner-1', 'study', 'original')).toBeNull();
  });

  it('does not resurrect a media URL when its drawing is deleted mid-load', async () => {
    const store = new MemoryDesegnLernadoStore();
    await store.saveDrawing('owner-1', drawing('study'), new Blob(['full']), new Blob(['preview']));
    let resolveMedia!: (blob: Blob | null) => void;
    store.loadMedia = vi.fn(() => new Promise<Blob | null>((resolve) => { resolveMedia = resolve; }));
    const state = new IloGState({} as IloGateway, store);
    state.configure('owner-1');
    await state.loadDesegnLernado();

    const pending = state.desegnLernadoMediaUrl('study', 'original');
    expect(await state.deleteDesegnDrawing('study')).toBe(true);
    resolveMedia(new Blob(['deleted'], { type: 'image/png' }));

    expect(await pending).toBeNull();
  });
});
