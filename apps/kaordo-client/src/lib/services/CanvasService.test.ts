import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceDetail } from '../domain/workspace';
import { CanvasGState } from '../states/CanvasGState';
import { CanvasService } from './CanvasService';
import { CanvasViewportService } from './CanvasViewportService';

const workspace: WorkspaceDetail = {
  id: 'workspace-1',
  name: 'Research',
  path: '/tmp/Research.vdw',
  objects: [
    {
      document: { elements: [], version: 1 },
      id: 'object-1',
      title: 'Project brief',
      type: 'Knowledge object',
    },
  ],
  warnings: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CanvasService interaction boundaries', () => {
  it('reads stable viewport bounds once for a pointer drag', () => {
    const state = new CanvasGState();
    const service = new CanvasService(state, () => workspace);
    const viewport = createViewport();
    const readBounds = vi
      .spyOn(viewport, 'getBoundingClientRect')
      .mockReturnValue(canvasBounds());
    service.attachViewport(viewport);

    const source = document.createElement('button');
    service.startObjectPointerDrag(
      pointerEvent(source, { clientX: 950, clientY: 140, pointerId: 4 }),
      workspace.objects[0],
    );
    service.continueObjectPointerDrag(
      pointerEvent(source, { clientX: 500, clientY: 330, pointerId: 4 }),
    );
    service.continueObjectPointerDrag(
      pointerEvent(source, { clientX: 540, clientY: 360, pointerId: 4 }),
    );

    expect(readBounds).toHaveBeenCalledTimes(1);
    service.cancelObjectPointerDrag(pointerEvent(source, { pointerId: 4 }));
  });

  it('uses the latest fractional pointer sample and commits without snap-back', () => {
    const state = new CanvasGState();
    state.place(workspace.id, workspace.objects[0], { x: 400, y: 312 });
    const service = new CanvasService(state, () => workspace);
    const viewport = createViewport();
    const positioner = document.createElement('div');
    positioner.className = 'canvas-card-positioner';
    positioner.dataset.canvasPositionerId = workspace.objects[0].id;
    positioner.style.transform = 'translate3d(400px, 312px, 0)';
    vi.spyOn(positioner, 'getBoundingClientRect').mockReturnValue({
      ...canvasBounds(),
      bottom: 388,
      left: 380,
      right: 620,
      top: 272,
      x: 380,
      y: 272,
    });
    const card = document.createElement('button');
    card.className = 'canvas-card canvas-card--entering';
    card.dataset.canvasObjectId = workspace.objects[0].id;
    positioner.append(card);
    viewport.append(positioner);
    service.attachViewport(viewport);

    service.startObjectPointerDrag(
      pointerEvent(card, { clientX: 400, clientY: 300, pointerId: 5 }),
      workspace.objects[0],
    );
    expect(card).not.toHaveClass('canvas-card--entering');

    const latest = pointerEvent(card, {
      clientX: 700.25,
      clientY: 500.75,
      pointerId: 5,
    });
    const move = pointerEvent(card, {
      clientX: 650,
      clientY: 450,
      getCoalescedEvents: () => [latest],
      pointerId: 5,
    });
    service.continueObjectPointerDrag(move);

    expect(positioner.style.transform).toBe(
      'translate3d(580.25px, 422.75px, 0)',
    );
    expect(card).toHaveClass('canvas-card--dragging');

    service.finishObjectPointerDrag(move);

    expect(positioner.style.transform).toBe('translate3d(580px, 423px, 0)');
    expect(card).not.toHaveClass('canvas-card--dragging');
    expect(state.placementsFor(workspace.id)[0]).toMatchObject({
      x: 580,
      y: 423,
    });
    state.exit();
  });

  it('coalesces scroll camera snapshots into one animation frame', () => {
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 9;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    const state = new CanvasGState();
    const service = new CanvasViewportService(state, () => workspace);
    const viewport = createViewport();
    viewport.scrollLeft = 120;
    viewport.scrollTop = 90;
    service.attach(viewport);
    const rememberCamera = vi.spyOn(state, 'rememberCamera');

    service.scheduleCameraCapture();
    service.scheduleCameraCapture();

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(rememberCamera).not.toHaveBeenCalled();
    frame?.(0);
    expect(rememberCamera).toHaveBeenCalledOnce();
    expect(state.cameraFor(workspace.id)).toEqual({
      centerX: 520,
      centerY: 390,
    });

    viewport.scrollLeft = 200;
    viewport.scrollTop = 160;
    service.scheduleCameraCapture();
    service.captureCamera();

    expect(cancelFrame).toHaveBeenCalledWith(9);
    expect(rememberCamera).toHaveBeenCalledTimes(2);
    expect(state.cameraFor(workspace.id)).toEqual({
      centerX: 600,
      centerY: 460,
    });
  });

  it('applies native wheel deltas on the next frame around the pointer', () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 17;
    }));
    const state = new CanvasGState();
    const service = new CanvasService(state, () => workspace);
    const viewport = createViewport();
    const zoomSpace = document.createElement('div');
    zoomSpace.className = 'canvas-zoom-space';
    const surface = document.createElement('div');
    surface.className = 'canvas-surface';
    zoomSpace.append(surface);
    viewport.append(zoomSpace);
    viewport.scrollLeft = 1000;
    viewport.scrollTop = 800;
    service.attachViewport(viewport);
    const wheel = new WheelEvent('wheel', {
      cancelable: true,
      clientX: 260,
      clientY: 170,
      deltaY: -100,
    });

    service.handleCanvasWheel(wheel);

    expect(state.zoomFor(workspace.id)).toBe(1);
    expect(frame).toBeDefined();
    frame?.(16);

    const zoom = state.zoomFor(workspace.id);
    expect(wheel.defaultPrevented).toBe(true);
    expect(zoom).toBeCloseTo(Math.exp(0.12), 5);
    expect((viewport.scrollLeft + 160) / zoom).toBeCloseTo(1160, 5);
    expect((viewport.scrollTop + 120) / zoom).toBeCloseTo(920, 5);
    expect(zoomSpace.style.width).toBe(`${4800 * zoom}px`);
    expect(zoomSpace.style.height).toBe(`${3200 * zoom}px`);
    expect(surface.style.transform).toBe(`scale(${zoom})`);
  });

  it('leaves two-finger scrolling native and handles ctrl-wheel as pinch zoom', () => {
    const requestFrame = vi.fn(() => 23);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const state = new CanvasGState();
    const service = new CanvasService(state, () => workspace);
    service.attachViewport(createViewport());
    const twoFingerScroll = new WheelEvent('wheel', {
      cancelable: true,
      deltaX: 3.5,
      deltaY: 12.25,
    });

    service.handleCanvasWheel(twoFingerScroll);

    expect(twoFingerScroll.defaultPrevented).toBe(false);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(state.zoomFor(workspace.id)).toBe(1);

    const pinch = new WheelEvent('wheel', {
      cancelable: true,
      ctrlKey: true,
      deltaY: -4,
    });
    service.handleCanvasWheel(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it('deletes a canvas element and persists the updated document', async () => {
    const saveCanvasDocument = vi.fn().mockResolvedValue(undefined);
    const state = new CanvasGState();
    state.setCanvasDocument(workspace.id, {
      elements: [
        {
          fill: '#ffffff',
          height: 90,
          id: 'rectangle-1',
          radius: 10,
          stroke: '#000000',
          strokeWidth: 2,
          type: 'rectangle',
          width: 140,
          x: 100,
          y: 120,
        },
      ],
      placements: [],
      version: 1,
    });
    state.selectGlobalElement('rectangle-1');
    const service = new CanvasService(
      state,
      () => workspace,
      undefined,
      undefined,
      saveCanvasDocument,
    );

    await service.deleteCanvasElement(workspace.id, 'rectangle-1');

    expect(state.canvasDocumentFor(workspace.id).elements).toEqual([]);
    expect(state.snapshot.selectedGlobalElementId).toBeNull();
    expect(saveCanvasDocument).toHaveBeenCalledWith(workspace.id, {
      elements: [],
      placements: [],
      version: 1,
    });
  });

  it('resizes an object from its minimum size to a very large frame', async () => {
    const state = new CanvasGState();
    const updateObject = vi.fn(
      async (_workspaceId: string, _objectId: string, document: WorkspaceDetail['objects'][number]['document']) => ({
        ...workspace.objects[0],
        document,
      }),
    );
    const service = new CanvasService(state, () => workspace, updateObject);
    const placement = state.place(workspace.id, workspace.objects[0], {
      x: 400,
      y: 300,
    });
    const positioner = document.createElement('div');
    positioner.className = 'canvas-card-positioner';
    positioner.style.width = `${placement.width}px`;
    positioner.style.height = `${placement.height}px`;
    const handle = document.createElement('button');
    handle.className = 'canvas-card-resize-handle';
    positioner.append(handle);
    Object.defineProperties(handle, {
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() },
    });

    service.startObjectResize(
      pointerEvent(handle, { clientX: 100, clientY: 100, pointerId: 15 }),
      placement,
    );
    service.finishObjectResize(
      pointerEvent(handle, { clientX: 1540, clientY: 1014, pointerId: 15 }),
    );
    expect(state.placementsFor(workspace.id)[0]).toMatchObject({
      height: 1200,
      width: 1800,
    });
    expect(positioner.style.width).toBe('1800px');
    expect(positioner.style.height).toBe('1200px');

    const large = state.placementsFor(workspace.id)[0];
    service.startObjectResize(
      pointerEvent(handle, { clientX: 100, clientY: 100, pointerId: 16 }),
      large,
    );
    service.finishObjectResize(
      pointerEvent(handle, { clientX: -5000, clientY: -5000, pointerId: 16 }),
    );
    expect(state.placementsFor(workspace.id)[0]).toMatchObject({
      height: 120,
      width: 160,
    });
    await vi.waitFor(() => expect(updateObject).toHaveBeenCalledTimes(2));
    expect(updateObject.mock.calls[1][2].frame).toEqual({
      height: 120,
      width: 160,
    });
  });

  it('ends pan and captures the final camera when pointer capture is lost', () => {
    const state = new CanvasGState();
    const service = new CanvasViewportService(state, () => workspace);
    const viewport = createViewport();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(viewport, {
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
      setPointerCapture: { configurable: true, value: vi.fn() },
    });
    service.attach(viewport);

    service.startPan(
      pointerEvent(viewport, {
        button: 0,
        clientX: 220,
        clientY: 180,
        pointerId: 7,
      }),
      false,
    );
    viewport.scrollLeft = 360;
    viewport.scrollTop = 280;
    service.handlePanCaptureLost(pointerEvent(viewport, { pointerId: 7 }));

    expect(state.snapshot.isPanning).toBe(false);
    expect(state.cameraFor(workspace.id)).toEqual({
      centerX: 760,
      centerY: 580,
    });
    expect(releasePointerCapture).not.toHaveBeenCalled();
  });
});

function createViewport(): HTMLDivElement {
  const viewport = document.createElement('div');
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 600 },
    clientWidth: { configurable: true, value: 800 },
  });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(canvasBounds());
  return viewport;
}

function canvasBounds(): DOMRect {
  return {
    bottom: 650,
    height: 600,
    left: 100,
    right: 900,
    top: 50,
    width: 800,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  };
}

function pointerEvent(
  currentTarget: EventTarget,
  values: Partial<PointerEvent>,
): PointerEvent {
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget,
    pointerId: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: currentTarget,
    ...values,
  } as unknown as PointerEvent;
}
