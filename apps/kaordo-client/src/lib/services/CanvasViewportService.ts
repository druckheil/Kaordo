import { tick } from 'svelte';
import type { CanvasPoint, CanvasViewport } from '../domain/canvas';
import type { WorkspaceDetail } from '../domain/workspace';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  canvasApplicationScale,
  cameraFromScroll,
  cameraScroll,
  clampCanvasZoom,
  pointerToCanvas,
} from '../features/canvas';
import { CanvasGState } from '../states/CanvasGState';

export type CanvasBounds = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>;

type PanStart = {
  clientX: number;
  clientY: number;
  pointerId: number;
  scrollLeft: number;
  scrollTop: number;
};

type ScheduledFrame = {
  id: number;
  kind: 'animation-frame' | 'timeout';
};

type PendingZoom = {
  anchor: CanvasPoint;
  workspaceId: string;
  zoom: number;
};

/** Owns the viewport element, pan lifecycle, and camera restoration. */
export class CanvasViewportService {
  readonly #getWorkspace: () => WorkspaceDetail | null;
  readonly #state: CanvasGState;
  #cameraRestoreAttempt = 0;
  #cameraFrame: ScheduledFrame | null = null;
  #cameraCommitTimer: number | null = null;
  #isRestoringCamera = false;
  #pan: PanStart | null = null;
  #pendingCamera: { camera: ReturnType<typeof cameraFromScroll>; workspaceId: string } | null = null;
  #pendingZoom: PendingZoom | null = null;
  #pendingCameraWorkspaceId: string | null = null;
  #hasPublishedScheduledCamera = false;
  #viewport: HTMLDivElement | null = null;
  #wheelGesture: 'mouse' | 'trackpad' | null = null;
  #wheelGestureAt = 0;
  #zoomFrame: number | null = null;

  constructor(
    state: CanvasGState,
    getWorkspace: () => WorkspaceDetail | null,
  ) {
    this.#state = state;
    this.#getWorkspace = getWorkspace;
  }

  get element(): HTMLDivElement | null {
    return this.#viewport;
  }

  attach(element: HTMLDivElement | null): void {
    this.#viewport = element;
    if (!element) {
      this.cancelScheduledCameraCapture();
      this.cancelZoomAnimation();
    }
  }

  bounds(): CanvasBounds | null {
    if (!this.#viewport) return null;
    const { bottom, left, right, top } = this.#viewport.getBoundingClientRect();
    return { bottom, left, right, top };
  }

  canvasPoint(
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number,
    bounds = this.bounds(),
    size?: { height: number; width: number },
    applicationScale = canvasApplicationScale(),
  ): CanvasPoint | null {
    if (!this.#viewport || !bounds) return null;
    return pointerToCanvas(
      { x: clientX, y: clientY },
      bounds,
      this.#viewport,
      { x: grabOffsetX, y: grabOffsetY },
      size,
      this.#state.zoomFor(this.#getWorkspace()?.id ?? ''),
      applicationScale,
    );
  }

  metrics(): CanvasViewport {
    const viewport = this.#viewport;
    if (!viewport) {
      return { height: 0, scrollLeft: 0, scrollTop: 0, width: 0 };
    }
    const { clientHeight, clientWidth } = viewport;
    const zoom = this.#state.zoomFor(this.#getWorkspace()?.id ?? '');
    const applicationScale = canvasApplicationScale();
    const bounds =
      clientHeight > 0 && clientWidth > 0
        ? null
        : viewport.getBoundingClientRect();
    return {
      height: (clientHeight || (bounds?.height ?? 0) / applicationScale) / zoom,
      scrollLeft: viewport.scrollLeft / zoom,
      scrollTop: viewport.scrollTop / zoom,
      width: (clientWidth || (bounds?.width ?? 0) / applicationScale) / zoom,
    };
  }

  zoomFromWheel(event: WheelEvent): void {
    const workspace = this.#getWorkspace();
    const viewport = this.#viewport;
    if (!workspace || !viewport || event.deltaY === 0) return;
    if (!event.ctrlKey && this.isTrackpadScroll(event)) {
      this.cancelZoomAnimation();
      return;
    }
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? viewport.clientHeight
        : 1);
    const base = this.#pendingZoom?.workspaceId === workspace.id
      ? this.#pendingZoom.zoom
      : this.#state.zoomFor(workspace.id);
    const bounds = viewport.getBoundingClientRect();
    const applicationScale = canvasApplicationScale();
    this.requestZoom(
      workspace.id,
      base * Math.exp(-delta * (event.ctrlKey ? 0.008 : 0.0012)),
      {
        x: Math.max(
          0,
          Math.min(viewport.clientWidth, (event.clientX - bounds.left) / applicationScale),
        ),
        y: Math.max(
          0,
          Math.min(viewport.clientHeight, (event.clientY - bounds.top) / applicationScale),
        ),
      },
    );
  }

  zoomBy(factor: number): void {
    const workspace = this.#getWorkspace();
    const viewport = this.#viewport;
    if (!workspace || !viewport) return;
    this.requestZoom(
      workspace.id,
      (this.#pendingZoom?.zoom ?? this.#state.zoomFor(workspace.id)) * factor,
      { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
    );
  }

  resetZoom(): void {
    const workspace = this.#getWorkspace();
    const viewport = this.#viewport;
    if (workspace && viewport) {
      this.requestZoom(
        workspace.id,
        1,
        { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
      );
    }
  }

  findCard(objectId: string): HTMLElement | null {
    const cards = this.#viewport?.querySelectorAll<HTMLElement>(
      '[data-canvas-object-id]',
    );
    if (!cards) return null;
    return (
      Array.from(cards).find(
        (card) => card.dataset.canvasObjectId === objectId,
      ) ?? null
    );
  }

  findPositioner(objectId: string): HTMLElement | null {
    const positioners = this.#viewport?.querySelectorAll<HTMLElement>(
      '[data-canvas-positioner-id]',
    );
    if (!positioners) return null;
    return (
      Array.from(positioners).find(
        (positioner) => positioner.dataset.canvasPositionerId === objectId,
      ) ?? null
    );
  }

  startPan(event: PointerEvent, blocked: boolean): void {
    if (
      event.button !== 0 ||
      blocked ||
      this.#pan ||
      !this.#viewport ||
      (event.target as Element | null)?.closest?.('.canvas-card')
    ) {
      return;
    }

    this.cancelZoomAnimation();
    event.preventDefault();
    this.#pan = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      scrollLeft: this.#viewport.scrollLeft,
      scrollTop: this.#viewport.scrollTop,
    };
    this.#state.setPanning(true);
    this.#viewport.setPointerCapture?.(event.pointerId);
  }

  continuePan(event: PointerEvent): void {
    const pan = this.#pan;
    if (!pan || pan.pointerId !== event.pointerId || !this.#viewport) return;
    const applicationScale = canvasApplicationScale();
    this.#viewport.scrollLeft =
      pan.scrollLeft - (event.clientX - pan.clientX) / applicationScale;
    this.#viewport.scrollTop =
      pan.scrollTop - (event.clientY - pan.clientY) / applicationScale;
  }

  finishPan(event: PointerEvent): void {
    const pan = this.#pan;
    if (!pan || pan.pointerId !== event.pointerId) return;
    this.endPan(pan, true);
  }

  handlePanCaptureLost(event: PointerEvent): void {
    const pan = this.#pan;
    if (!pan || pan.pointerId !== event.pointerId) return;
    this.endPan(pan, false);
  }

  clearPan(): void {
    const pan = this.#pan;
    if (!pan) return;
    this.endPan(pan, true);
  }

  scheduleCameraCapture(workspaceId = this.#getWorkspace()?.id): void {
    if (
      !workspaceId ||
      !this.#viewport ||
      this.#isRestoringCamera
    ) return;
    this.#pendingCameraWorkspaceId = workspaceId;
    if (this.#cameraFrame) return;

    const capture = () => {
      this.#cameraFrame = null;
      const pendingWorkspaceId = this.#pendingCameraWorkspaceId;
      this.#pendingCameraWorkspaceId = null;
      const pending = this.readCamera(pendingWorkspaceId ?? undefined);
      if (!pending) return;

      // Camera coordinates are persistence data, not render state. Publish at
      // the start and after scrolling settles, rather than invalidating every
      // canvas child on every native scroll event.
      this.#pendingCamera = pending;
      if (!this.#hasPublishedScheduledCamera) {
        this.publishPendingCamera();
      }
      this.scheduleIdleCameraCommit();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      this.#cameraFrame = {
        id: window.requestAnimationFrame(capture),
        kind: 'animation-frame',
      };
    } else {
      this.#cameraFrame = {
        id: window.setTimeout(capture, 0),
        kind: 'timeout',
      };
    }
  }

  captureCamera(workspaceId = this.#getWorkspace()?.id): void {
    this.cancelScheduledCameraCapture();
    this.captureCameraNow(workspaceId);
  }

  async restoreCamera(workspaceId: string): Promise<void> {
    this.cancelScheduledCameraCapture();
    const attempt = ++this.#cameraRestoreAttempt;
    this.#isRestoringCamera = true;
    await tick();
    if (attempt !== this.#cameraRestoreAttempt) return;
    if (this.#getWorkspace()?.id !== workspaceId) {
      this.#isRestoringCamera = false;
      return;
    }

    const viewport = this.#viewport;
    if (!viewport) {
      this.#isRestoringCamera = false;
      this.#state.markCameraReady();
      return;
    }

    const metrics = this.metrics();
    const scroll = cameraScroll(this.#state.cameraFor(workspaceId), metrics);
    viewport.style.scrollBehavior = 'auto';
    const zoom = this.#state.zoomFor(workspaceId);
    viewport.scrollLeft = scroll.x * zoom;
    viewport.scrollTop = scroll.y * zoom;
    viewport.style.removeProperty('scroll-behavior');
    this.#isRestoringCamera = false;
    this.#state.cameraRestored(
      workspaceId,
      cameraFromScroll(scroll, metrics),
    );
  }

  invalidateCameraRestore(): void {
    this.#cameraRestoreAttempt += 1;
    this.#isRestoringCamera = false;
    this.cancelScheduledCameraCapture();
    this.cancelZoomAnimation();
  }

  async focusCard(
    workspaceId: string,
    objectId: string,
    position: ScrollLogicalPosition = 'center',
  ): Promise<void> {
    await tick();
    if (this.#getWorkspace()?.id !== workspaceId) return;
    const card = this.findCard(objectId);
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    card?.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: position,
      inline: position,
    });
    const focusTarget =
      card?.querySelector<HTMLElement>('.canvas-card-drag-handle') ?? card;
    focusTarget?.focus({ preventScroll: true });
  }

  async focusCanvasElement(workspaceId: string, elementId: string): Promise<void> {
    await tick();
    if (this.#getWorkspace()?.id !== workspaceId) return;
    const element = Array.from(
      this.#viewport?.querySelectorAll<HTMLElement>('[data-canvas-element-id]') ?? [],
    ).find((candidate) => candidate.dataset.canvasElementId === elementId);
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    element?.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center',
    });
    element?.focus({ preventScroll: true });
  }

  private endPan(pan: PanStart, releaseCapture: boolean): void {
    this.#pan = null;
    this.#state.setPanning(false);
    if (
      releaseCapture &&
      this.#viewport?.hasPointerCapture?.(pan.pointerId)
    ) {
      this.#viewport.releasePointerCapture(pan.pointerId);
    }
    this.captureCamera();
  }

  private requestZoom(
    workspaceId: string,
    requestedZoom: number,
    anchor: CanvasPoint,
  ): void {
    const viewport = this.#viewport;
    if (!viewport) return;
    const target = clampCanvasZoom(requestedZoom);
    if (
      Math.abs(target - this.#state.zoomFor(workspaceId)) < 0.0001 &&
      this.#zoomFrame === null
    ) return;

    this.#pendingZoom = { anchor, workspaceId, zoom: target };
    if (this.#zoomFrame !== null) return;

    if (typeof window.requestAnimationFrame !== 'function') {
      this.flushZoom();
      return;
    }
    this.#zoomFrame = window.requestAnimationFrame(() => this.flushZoom());
  }

  private flushZoom(): void {
    this.#zoomFrame = null;
    const pending = this.#pendingZoom;
    this.#pendingZoom = null;
    if (!pending || !this.#viewport) return;
    this.applyZoomFrame(pending);
  }

  private applyZoomFrame({ anchor, workspaceId, zoom: next }: PendingZoom): void {
    const viewport = this.#viewport;
    if (!viewport) return;

    const current = this.#state.zoomFor(workspaceId);
    const canvasAnchor = {
      x: (viewport.scrollLeft + anchor.x) / current,
      y: (viewport.scrollTop + anchor.y) / current,
    };

    this.#state.setZoom(workspaceId, next);
    const zoomSpace = viewport.querySelector<HTMLElement>('.canvas-zoom-space');
    const surface = viewport.querySelector<HTMLElement>('.canvas-surface');
    if (zoomSpace) {
      zoomSpace.style.width = `${CANVAS_WIDTH * next}px`;
      zoomSpace.style.height = `${CANVAS_HEIGHT * next}px`;
    }
    if (surface) surface.style.transform = `scale(${next})`;
    viewport.scrollLeft = canvasAnchor.x * next - anchor.x;
    viewport.scrollTop = canvasAnchor.y * next - anchor.y;
  }

  private cancelZoomAnimation(): void {
    if (this.#zoomFrame !== null) {
      window.cancelAnimationFrame?.(this.#zoomFrame);
    }
    this.#zoomFrame = null;
    this.#pendingZoom = null;
  }

  private isTrackpadScroll(event: WheelEvent): boolean {
    const now = performance.now();
    if (now - this.#wheelGestureAt > 140 || this.#wheelGesture === null) {
      const legacyDelta = Math.abs(
        (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0,
      );
      const looksLikeMouseWheel =
        event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        (legacyDelta >= 120 && legacyDelta % 120 === 0) ||
        (Math.abs(event.deltaX) < 1 && Math.abs(event.deltaY) >= 50);
      this.#wheelGesture = looksLikeMouseWheel ? 'mouse' : 'trackpad';
    }
    this.#wheelGestureAt = now;
    return this.#wheelGesture === 'trackpad';
  }

  private captureCameraNow(workspaceId = this.#getWorkspace()?.id): void {
    const pending = this.readCamera(workspaceId);
    if (!pending) return;
    this.#pendingCamera = null;
    this.#state.rememberCamera(pending.workspaceId, pending.camera);
  }

  private cancelScheduledCameraCapture(): void {
    const frame = this.#cameraFrame;
    if (frame?.kind === 'animation-frame') {
      window.cancelAnimationFrame(frame.id);
    } else if (frame) {
      window.clearTimeout(frame.id);
    }
    if (this.#cameraCommitTimer !== null) {
      window.clearTimeout(this.#cameraCommitTimer);
    }
    this.#cameraFrame = null;
    this.#cameraCommitTimer = null;
    this.#pendingCamera = null;
    this.#pendingCameraWorkspaceId = null;
    this.#hasPublishedScheduledCamera = false;
  }

  private readCamera(
    workspaceId = this.#getWorkspace()?.id,
  ): { camera: ReturnType<typeof cameraFromScroll>; workspaceId: string } | null {
    if (!workspaceId || !this.#viewport || this.#isRestoringCamera) return null;
    const viewport = this.metrics();
    return {
      camera: cameraFromScroll(
        { x: viewport.scrollLeft, y: viewport.scrollTop },
        viewport,
      ),
      workspaceId,
    };
  }

  private publishPendingCamera(): void {
    const pending = this.#pendingCamera;
    if (!pending) return;
    this.#pendingCamera = null;
    this.#hasPublishedScheduledCamera = true;
    this.#state.rememberCamera(pending.workspaceId, pending.camera);
  }

  private scheduleIdleCameraCommit(): void {
    if (this.#cameraCommitTimer !== null) {
      window.clearTimeout(this.#cameraCommitTimer);
    }
    this.#cameraCommitTimer = window.setTimeout(() => {
      this.#cameraCommitTimer = null;
      this.publishPendingCamera();
      this.#hasPublishedScheduledCamera = false;
    }, CAMERA_IDLE_CAPTURE_MS);
  }
}

const CAMERA_IDLE_CAPTURE_MS = 140;
