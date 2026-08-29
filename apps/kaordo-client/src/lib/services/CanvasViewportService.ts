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
  #cameraCommitTimer: number | null = null;
  #isRestoringCamera = false;
  #pan: PanStart | null = null;
  #pendingZoom: PendingZoom | null = null;
  #pendingCameraWorkspaceId: string | null = null;
  #viewport: HTMLDivElement | null = null;
  #wheelGesture: 'mouse' | 'trackpad' | null = null;
  #wheelGestureAt = 0;
  #zoomFrame: number | null = null;
  #zoomWillChangeTimer: number | null = null;

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
      this.clearZoomWillChange();
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

  zoomFromWheel(event: WheelEvent, canPreventDefault = true): boolean {
    const workspace = this.#getWorkspace();
    const viewport = this.#viewport;
    if (!workspace || !viewport || event.deltaY === 0) return false;
    if (!event.ctrlKey && this.isTrackpadScroll(event)) {
      if (this.#zoomFrame !== null || this.#pendingZoom !== null) {
        this.cancelZoomAnimation();
      }
      return false;
    }
    if (canPreventDefault && event.cancelable) event.preventDefault();
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
    return true;
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

    // Camera coordinates are persistence data, not render state. Do not read
    // layout or publish a new Svelte snapshot while native scrolling is in
    // progress: both operations force work on the main thread and make
    // high-frequency touchpad scrolling visibly stutter. Capture once after
    // the gesture has been idle for a short interval instead.
    if (this.#cameraCommitTimer !== null) {
      window.clearTimeout(this.#cameraCommitTimer);
    }
    this.#cameraCommitTimer = window.setTimeout(() => {
      this.#cameraCommitTimer = null;
      const pendingWorkspaceId = this.#pendingCameraWorkspaceId;
      this.#pendingCameraWorkspaceId = null;
      this.captureCameraNow(pendingWorkspaceId ?? undefined);
    }, CAMERA_IDLE_CAPTURE_MS);
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
    if (surface) {
      // Promote the large surface only while zooming. Keeping a permanent
      // 4800×3200 compositor layer makes native scrolling compete for GPU
      // memory, especially in scaled Tauri windows.
      surface.style.willChange = 'transform';
      surface.style.transform = `scale(${next})`;
      if (this.#zoomWillChangeTimer !== null) {
        window.clearTimeout(this.#zoomWillChangeTimer);
      }
      this.#zoomWillChangeTimer = window.setTimeout(() => {
        this.#zoomWillChangeTimer = null;
        surface.style.removeProperty('will-change');
      }, ZOOM_WILL_CHANGE_MS);
    }
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

  private clearZoomWillChange(): void {
    if (this.#zoomWillChangeTimer !== null) {
      window.clearTimeout(this.#zoomWillChangeTimer);
      this.#zoomWillChangeTimer = null;
    }
    this.#viewport?.querySelector<HTMLElement>('.canvas-surface')
      ?.style.removeProperty('will-change');
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
    if (!workspaceId || !this.#viewport || this.#isRestoringCamera) return;
    const viewport = this.metrics();
    this.#state.rememberCamera(
      workspaceId,
      cameraFromScroll(
        { x: viewport.scrollLeft, y: viewport.scrollTop },
        viewport,
      ),
    );
  }

  private cancelScheduledCameraCapture(): void {
    if (this.#cameraCommitTimer !== null) {
      window.clearTimeout(this.#cameraCommitTimer);
    }
    this.#cameraCommitTimer = null;
    this.#pendingCameraWorkspaceId = null;
  }
}

const CAMERA_IDLE_CAPTURE_MS = 140;
const ZOOM_WILL_CHANGE_MS = 180;
