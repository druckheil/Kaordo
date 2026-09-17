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
import {
  refreshCanvasVisibility,
  suspendCanvasVisibility,
} from '../features/canvasMediaVisibility';
import { notifyAllTextLayoutsChanged } from '../features/textLayout';
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

type LiveZoom = {
  offsetX: number;
  offsetY: number;
  workspaceId: string;
  zoom: number;
};

type WheelViewportGeometry = {
  height: number;
  left: number;
  top: number;
  width: number;
};

/** Owns the viewport element, pan lifecycle, and camera restoration. */
export class CanvasViewportService {
  readonly #getWorkspace: () => WorkspaceDetail | null;
  readonly #state: CanvasGState;
  #cameraRestoreAttempt = 0;
  #cameraCommitTimer: number | null = null;
  #isRestoringCamera = false;
  #pan: PanStart | null = null;
  #panFrame: number | null = null;
  #pendingPan: { scrollLeft: number; scrollTop: number } | null = null;
  #liveZoom: LiveZoom | null = null;
  #pendingZoom: PendingZoom | null = null;
  #pendingCameraWorkspaceId: string | null = null;
  #viewport: HTMLDivElement | null = null;
  #wheelGesture: 'mouse' | 'trackpad' | null = null;
  #wheelGestureAt = 0;
  #wheelGeometry: WheelViewportGeometry | null = null;
  #wheelGeometryAt = 0;
  #zoomFrame: number | null = null;
  #zoomCommitTimer: number | null = null;
  #textLayoutFrame: number | null = null;
  #zoomSpace: HTMLElement | null = null;
  #surface: HTMLElement | null = null;

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
    if (this.#viewport && this.#viewport !== element) {
      this.commitLiveZoom();
      this.clearScrollPerformanceMode();
    }
    this.#viewport = element;
    this.#wheelGeometry = null;
    this.#wheelGeometryAt = 0;
    this.#zoomSpace = element?.querySelector<HTMLElement>('.canvas-zoom-space') ?? null;
    this.#surface = element?.querySelector<HTMLElement>('.canvas-surface') ?? null;
    const zoom = this.currentZoom();
    if (element) {
      element.style.setProperty('--canvas-zoom', `${zoom}`);
      this.syncZoomSpace(zoom);
      if (this.#surface) {
        this.#surface.style.transform = Math.abs(zoom - 1) < 0.0001
          ? ''
          : `scale(${zoom})`;
      }
    }
    this.updateZoomPresentation(zoom);
    if (!element) {
      this.cancelScheduledCameraCapture();
      this.cancelPanFrame();
      this.cancelZoomAnimation();
      this.cancelTextLayoutRefresh();
    }
  }

  /**
   * Marks native scrolling as a short-lived compositor-critical phase.
   * Rendering keeps its state untouched; CSS only removes expensive effects
   * until the scroll gesture has settled.
   */
  handleScroll(): void {
    const viewport = this.#viewport;
    if (!viewport) return;
    viewport.classList.add('canvas-viewport--scrolling');
  }

  /** Returns the visual zoom, including a zoom gesture not committed to state yet. */
  currentZoom(workspaceId = this.#getWorkspace()?.id ?? ''): number {
    if (this.#liveZoom?.workspaceId === workspaceId) return this.#liveZoom.zoom;
    return this.#state.zoomFor(workspaceId);
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
    const visualScroll = this.visualScroll();
    return pointerToCanvas(
      { x: clientX, y: clientY },
      bounds,
      visualScroll,
      { x: grabOffsetX, y: grabOffsetY },
      size,
      this.currentZoom(),
      applicationScale,
    );
  }

  metrics(): CanvasViewport {
    const viewport = this.#viewport;
    if (!viewport) {
      return { height: 0, scrollLeft: 0, scrollTop: 0, width: 0 };
    }
    const { clientHeight, clientWidth } = viewport;
    const zoom = this.currentZoom();
    const applicationScale = canvasApplicationScale();
    const visualScroll = this.visualScroll();
    const bounds =
      clientHeight > 0 && clientWidth > 0
        ? null
        : viewport.getBoundingClientRect();
    return {
      height: (clientHeight || (bounds?.height ?? 0) / applicationScale) / zoom,
      scrollLeft: visualScroll.scrollLeft / zoom,
      scrollTop: visualScroll.scrollTop / zoom,
      width: (clientWidth || (bounds?.width ?? 0) / applicationScale) / zoom,
    };
  }

  zoomFromWheel(event: WheelEvent, canPreventDefault = true): boolean {
    const workspace = this.#getWorkspace();
    const viewport = this.#viewport;
    if (!workspace || !viewport || event.deltaY === 0) return false;
    if (!event.ctrlKey && this.isTrackpadScroll(event)) {
      if (
        this.#zoomFrame !== null ||
        this.#pendingZoom !== null ||
        this.#liveZoom !== null
      ) {
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
      : this.currentZoom(workspace.id);
    const applicationScale = canvasApplicationScale();
    const now = performance.now();
    if (!this.#wheelGeometry || now - this.#wheelGeometryAt > WHEEL_GEOMETRY_CACHE_MS) {
      const bounds = viewport.getBoundingClientRect();
      this.#wheelGeometry = {
        height: viewport.clientHeight,
        left: bounds.left,
        top: bounds.top,
        width: viewport.clientWidth,
      };
      this.#wheelGeometryAt = now;
    }
    const geometry = this.#wheelGeometry;
    this.requestZoom(
      workspace.id,
      base * Math.exp(-delta * (event.ctrlKey ? 0.008 : 0.0012)),
      {
        x: Math.max(
          0,
          Math.min(geometry.width, (event.clientX - geometry.left) / applicationScale),
        ),
        y: Math.max(
          0,
          Math.min(geometry.height, (event.clientY - geometry.top) / applicationScale),
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
      (this.#pendingZoom?.zoom ?? this.currentZoom(workspace.id)) * factor,
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
    this.cancelPanFrame();
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
    const sample = event.getCoalescedEvents?.().at(-1) ?? event;
    const applicationScale = canvasApplicationScale();
    this.#pendingPan = {
      scrollLeft: pan.scrollLeft - (sample.clientX - pan.clientX) / applicationScale,
      scrollTop: pan.scrollTop - (sample.clientY - pan.clientY) / applicationScale,
    };
    if (typeof window.requestAnimationFrame !== 'function') {
      this.flushPan();
      return;
    }
    if (this.#panFrame !== null) return;
    this.#panFrame = window.requestAnimationFrame(() => {
      this.#panFrame = null;
      this.flushPan();
    });
  }

  finishPan(event: PointerEvent): void {
    const pan = this.#pan;
    if (!pan || pan.pointerId !== event.pointerId) return;
    this.continuePan(event);
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
      if (
        this.#liveZoom ||
        this.#zoomFrame !== null ||
        this.#pendingZoom !== null
      ) return;
      this.#pendingCameraWorkspaceId = null;
      this.captureCameraNow(pendingWorkspaceId ?? undefined);
      this.clearScrollPerformanceMode();
    }, CAMERA_IDLE_CAPTURE_MS);
  }

  captureCamera(workspaceId = this.#getWorkspace()?.id): void {
    this.cancelScheduledCameraCapture();
    this.commitLiveZoom();
    this.clearScrollPerformanceMode();
    this.captureCameraNow(workspaceId);
  }

  async restoreCamera(workspaceId: string): Promise<void> {
    this.commitLiveZoom();
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
    this.clearScrollPerformanceMode();
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
    if (card) revealCanvasTarget(card);
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
    if (element) revealCanvasTarget(element);
    element?.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center',
    });
    element?.focus({ preventScroll: true });
  }

  private endPan(pan: PanStart, releaseCapture: boolean): void {
    this.flushPan();
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

  private flushPan(): void {
    if (this.#panFrame !== null) {
      window.cancelAnimationFrame?.(this.#panFrame);
      this.#panFrame = null;
    }
    const pending = this.#pendingPan;
    this.#pendingPan = null;
    if (!pending || !this.#pan || !this.#viewport) return;
    this.#viewport.scrollLeft = pending.scrollLeft;
    this.#viewport.scrollTop = pending.scrollTop;
  }

  private cancelPanFrame(): void {
    if (this.#panFrame !== null) {
      window.cancelAnimationFrame?.(this.#panFrame);
      this.#panFrame = null;
    }
    this.#pendingPan = null;
  }

  private requestZoom(
    workspaceId: string,
    requestedZoom: number,
    anchor: CanvasPoint,
  ): void {
    const viewport = this.#viewport;
    if (!viewport) return;
    const target = clampCanvasZoom(requestedZoom);
    const current = this.currentZoom(workspaceId);
    if (
      Math.abs(target - current) < 0.0001 &&
      this.#zoomFrame === null &&
      this.#pendingZoom === null
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

    const live = this.#liveZoom?.workspaceId === workspaceId
      ? this.#liveZoom
      : null;
    const current = live?.zoom ?? this.#state.zoomFor(workspaceId);
    const canvasAnchor = {
      x: (viewport.scrollLeft + anchor.x - (live?.offsetX ?? 0)) / current,
      y: (viewport.scrollTop + anchor.y - (live?.offsetY ?? 0)) / current,
    };
    const offsetX = viewport.scrollLeft + anchor.x - canvasAnchor.x * next;
    const offsetY = viewport.scrollTop + anchor.y - canvasAnchor.y * next;

    // Keep the high-frequency part of zoom outside the reactive snapshot.
    // Publishing here would make every CanvasCard and every canvas element
    // re-run its Svelte update path once per wheel frame.
    this.#liveZoom = {
      offsetX,
      offsetY,
      workspaceId,
      zoom: next,
    };
    viewport.classList.add('canvas-viewport--zooming');
    suspendCanvasVisibility(viewport);
    const surface = this.#surface ?? viewport.querySelector<HTMLElement>('.canvas-surface');
    if (surface) {
      if (Math.abs(next - 1) < 0.0001) {
        surface.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
      } else {
        surface.style.transform =
          `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${next})`;
      }
    }
    this.updateZoomPresentation(next);
    this.scheduleZoomCommit(workspaceId);
  }

  private cancelZoomAnimation(commitLive = true): void {
    if (this.#zoomFrame !== null) {
      window.cancelAnimationFrame?.(this.#zoomFrame);
    }
    this.#zoomFrame = null;
    this.#pendingZoom = null;
    if (commitLive) this.commitLiveZoom();
  }

  /**
   * Range rectangles are reported in visual coordinates. Invalidate them in
   * the frame after the compositor has applied the new canvas scale; reading
   * them synchronously with `setZoom` can otherwise divide old rectangles by
   * the new zoom and make word-bound arrows drift until the file is reopened.
   */
  private scheduleTextLayoutRefresh(): void {
    if (this.#textLayoutFrame !== null) {
      window.cancelAnimationFrame?.(this.#textLayoutFrame);
      this.#textLayoutFrame = null;
    }
    if (typeof window.requestAnimationFrame !== 'function') {
      notifyAllTextLayoutsChanged();
      return;
    }
    this.#textLayoutFrame = window.requestAnimationFrame(() => {
      this.#textLayoutFrame = null;
      notifyAllTextLayoutsChanged();
    });
  }

  private cancelTextLayoutRefresh(): void {
    if (this.#textLayoutFrame === null) return;
    window.cancelAnimationFrame?.(this.#textLayoutFrame);
    this.#textLayoutFrame = null;
  }

  private clearScrollPerformanceMode(): void {
    this.#viewport?.classList.remove(
      'canvas-viewport--scrolling',
      'canvas-viewport--zooming',
    );
  }

  private scheduleZoomCommit(workspaceId: string): void {
    if (this.#zoomCommitTimer !== null) {
      window.clearTimeout(this.#zoomCommitTimer);
    }
    this.#zoomCommitTimer = window.setTimeout(() => {
      this.#zoomCommitTimer = null;
      this.commitLiveZoom(workspaceId);
    }, ZOOM_IDLE_COMMIT_MS);
  }

  private commitLiveZoom(workspaceId = this.#liveZoom?.workspaceId): void {
    if (
      !this.#liveZoom ||
      (workspaceId && this.#liveZoom.workspaceId !== workspaceId)
    ) return;
    const liveZoom = this.#liveZoom;
    this.#liveZoom = null;
    if (this.#zoomCommitTimer !== null) {
      window.clearTimeout(this.#zoomCommitTimer);
      this.#zoomCommitTimer = null;
    }
    const viewport = this.#viewport;
    const scrollLeft = viewport?.scrollLeft ?? 0;
    const scrollTop = viewport?.scrollTop ?? 0;
    const nextScrollLeft = scrollLeft - liveZoom.offsetX;
    const nextScrollTop = scrollTop - liveZoom.offsetY;
    this.syncZoomSpace(liveZoom.zoom);
    if (viewport) {
      viewport.style.setProperty('--canvas-zoom', `${liveZoom.zoom}`);
      viewport.scrollLeft = clampScroll(
        nextScrollLeft,
        CANVAS_WIDTH * liveZoom.zoom,
        viewport.clientWidth,
      );
      viewport.scrollTop = clampScroll(
        nextScrollTop,
        CANVAS_HEIGHT * liveZoom.zoom,
        viewport.clientHeight,
      );
    }
    if (this.#surface) {
      if (Math.abs(liveZoom.zoom - 1) < 0.0001) {
        this.#surface.style.removeProperty('transform');
      } else {
        this.#surface.style.transform = `scale(${liveZoom.zoom})`;
      }
    }
    const changed = Math.abs(
      this.#state.zoomFor(liveZoom.workspaceId) - liveZoom.zoom,
    ) >= 0.0001;
    if (changed) {
      this.#state.setZoom(liveZoom.workspaceId, liveZoom.zoom);
      this.scheduleTextLayoutRefresh();
    }
    this.updateZoomPresentation(liveZoom.zoom);
    this.#viewport?.classList.remove(
      'canvas-viewport--scrolling',
      'canvas-viewport--zooming',
    );
    refreshCanvasVisibility(this.#viewport);
    const pendingCameraWorkspaceId = this.#pendingCameraWorkspaceId;
    if (pendingCameraWorkspaceId) {
      this.#pendingCameraWorkspaceId = null;
      this.captureCameraNow(pendingCameraWorkspaceId);
    }
  }

  private updateZoomPresentation(zoom: number): void {
    this.#viewport?.classList.toggle(
      'canvas-viewport--overview',
      zoom <= CANVAS_OVERVIEW_ZOOM,
    );
  }

  private syncZoomSpace(
    zoom: number,
    zoomSpace = this.#zoomSpace,
  ): void {
    if (!zoomSpace) return;
    zoomSpace.style.width = `${CANVAS_WIDTH * zoom}px`;
    zoomSpace.style.height = `${CANVAS_HEIGHT * zoom}px`;
  }

  private visualScroll(): { scrollLeft: number; scrollTop: number } {
    const live = this.#liveZoom;
    return {
      scrollLeft: (this.#viewport?.scrollLeft ?? 0) - (live?.offsetX ?? 0),
      scrollTop: (this.#viewport?.scrollTop ?? 0) - (live?.offsetY ?? 0),
    };
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

function revealCanvasTarget(target: HTMLElement): void {
  let current: HTMLElement | null = target;
  while (current) {
    current.classList.remove('canvas-canvas-item--offscreen');
    if (current.classList.contains('canvas-viewport')) break;
    current = current.parentElement;
  }
}

const CAMERA_IDLE_CAPTURE_MS = 140;
const ZOOM_IDLE_COMMIT_MS = 160;
const CANVAS_OVERVIEW_ZOOM = 0.6;
const WHEEL_GEOMETRY_CACHE_MS = 500;

function clampScroll(value: number, contentSize: number, viewportSize: number): number {
  return Math.max(0, Math.min(Math.max(0, contentSize - viewportSize), value));
}
