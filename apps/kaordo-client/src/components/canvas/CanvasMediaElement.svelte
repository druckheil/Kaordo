<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { MediaElement } from '../../lib/domain/workspace';
  import {
    CANVAS_MEDIA_MAX_HEIGHT,
    CANVAS_MEDIA_MAX_WIDTH,
    CANVAS_MEDIA_MIN_HEIGHT,
    CANVAS_MEDIA_MIN_WIDTH,
  } from '../../lib/features/canvasMedia';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import KaordoVideoPlayer from '../ui/KaordoVideoPlayer.svelte';
  import PhotoViewer from '../ui/PhotoViewer.svelte';

  type Props = {
    canvas: CanvasService;
    element: MediaElement;
    maxHeight?: number;
    maxWidth?: number;
    moving?: boolean;
    onContextMenu?: (event: MouseEvent) => void;
    onStartMove: (event: PointerEvent, element: MediaElement) => void;
    selected: boolean;
    workspaceId: string;
  };

  let {
    canvas,
    element,
    maxHeight = CANVAS_MEDIA_MAX_HEIGHT,
    maxWidth = CANVAS_MEDIA_MAX_WIDTH,
    moving = false,
    onContextMenu,
    onStartMove,
    selected,
    workspaceId,
  }: Props = $props();
  let mediaUrl = $state<string | null>(null);
  let loadState = $state<'loading' | 'ready' | 'error'>('loading');
  let showPhotoViewer = $state(false);
  let audio = $state<HTMLAudioElement>();
  let audioPlaying = $state(false);
  let audioDuration = $state(0);
  let audioTime = $state(0);
  let audioVolume = $state(1);
  let pendingMove = $state<PendingMove | null>(null);
  let pendingMoveCaptureTarget: HTMLElement | null = null;
  let suppressImageClick = false;
  let mediaLoadVersion = 0;
  let loadedMediaKey: string | null = null;
  let resize = $state<ResizeGesture | null>(null);
  let resizedSize = $state<{ height: number; width: number } | null>(null);

  $effect(() => {
    const currentWorkspaceId = workspaceId;
    const mediaId = element.mediaId;
    const mimeType = element.mimeType;
    const nextKey = `${currentWorkspaceId}:${mediaId}:${mimeType}`;
    // Position, size, selection and parent changes replace the element object,
    // but must not restart an already loaded media resource. Only identity or
    // MIME changes require another storage read and object URL.
    if (loadedMediaKey === nextKey) return;
    loadedMediaKey = nextKey;
    const version = ++mediaLoadVersion;
    loadState = 'loading';
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
    void canvas.loadCanvasMedia(currentWorkspaceId, { mediaId, mimeType }).then((blob) => {
      if (version !== mediaLoadVersion) return;
      if (!blob) {
        loadState = 'error';
        return;
      }
      mediaUrl = URL.createObjectURL(blob);
      loadState = 'ready';
    }).catch(() => {
      if (version === mediaLoadVersion) loadState = 'error';
    });
  });

  onDestroy(() => {
    mediaLoadVersion += 1;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
    clearPendingMove();
    audio?.pause();
  });

  $effect(() => {
    const player = audio;
    if (player) player.volume = audioVolume;
  });

  function startInteraction(event: PointerEvent) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (moving) return;
    if (isDragHandle(event.target)) {
      startHandleMove(event);
      return;
    }
    if ((element.kind === 'image' || element.kind === 'gif') && isImageTarget(event.target)) {
      beginImageMove(event);
      return;
    }
    if (isInteractiveTarget(event.target)) return;
    onStartMove(event, element);
  }

  function beginImageMove(event: PointerEvent) {
    canvas.state.selectGlobalElement(element.id);
    pendingMove = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    pendingMoveCaptureTarget = event.target instanceof HTMLElement
      ? event.target
      : event.currentTarget as HTMLElement;
    pendingMoveCaptureTarget.setPointerCapture?.(event.pointerId);
  }

  function continueInteraction(event: PointerEvent) {
    if (!pendingMove || pendingMove.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pendingMove.startClientX,
      event.clientY - pendingMove.startClientY,
    );
    if (distance < 4) return;
    clearPendingMove();
    suppressImageClick = true;
    window.setTimeout(() => { suppressImageClick = false; }, 350);
    event.preventDefault();
    event.stopPropagation();
    onStartMove(event, element);
  }

  function finishInteraction(event: PointerEvent) {
    if (!pendingMove || pendingMove.pointerId !== event.pointerId) return;
    clearPendingMove();
  }

  function clearPendingMove() {
    if (pendingMove && pendingMoveCaptureTarget?.hasPointerCapture?.(pendingMove.pointerId)) {
      pendingMoveCaptureTarget.releasePointerCapture(pendingMove.pointerId);
    }
    pendingMoveCaptureTarget = null;
    pendingMove = null;
  }

  function startHandleMove(event: PointerEvent) {
    if (event.button !== 0 || moving) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.state.selectGlobalElement(element.id);
    onStartMove(event, element);
  }

  function handleImageClick(event: MouseEvent) {
    if (suppressImageClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressImageClick = false;
      return;
    }
    showPhotoViewer = true;
  }

  function startResize(event: PointerEvent) {
    if (event.button !== 0 || element.kind === 'audio') return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    resize = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startHeight: element.height,
      startWidth: element.width,
    };
    resizedSize = { height: element.height, width: element.width };
  }

  function continueResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const zoom = canvas.currentZoom();
    resizedSize = {
      ...proportionalSize(
        resize.startWidth,
        resize.startHeight,
        dominantResizeScale(
          resize.startWidth,
          resize.startHeight,
          (event.clientX - resize.startClientX) / zoom,
          (event.clientY - resize.startClientY) / zoom,
        ),
      ),
    };
  }

  function finishResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const size = resizedSize ?? { height: element.height, width: element.width };
    resize = null;
    resizedSize = null;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    void canvas.updateCanvasElement(workspaceId, {
      ...element,
      height: Math.round(size.height),
      width: Math.round(size.width),
    }).catch(() => canvas.state.announce('Media size could not be saved.'));
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    if (element.kind === 'audio') return;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (!horizontal && !vertical) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = (event.shiftKey ? 40 : 12) * (
      event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    );
    const step = Math.abs(delta) / Math.max(element.width, element.height, 1);
    const size = proportionalSize(
      element.width,
      element.height,
      1 + (vertical || horizontal ? (delta < 0 ? -step : step) : 0),
    );
    void canvas.updateCanvasElement(workspaceId, { ...element, ...size })
      .catch(() => canvas.state.announce('Media size could not be saved.'));
  }

  function dominantResizeScale(
    startWidth: number,
    startHeight: number,
    deltaWidth: number,
    deltaHeight: number,
  ): number {
    const widthScale = (startWidth + deltaWidth) / Math.max(startWidth, 1);
    const heightScale = (startHeight + deltaHeight) / Math.max(startHeight, 1);
    return Math.abs(deltaWidth) >= Math.abs(deltaHeight) ? widthScale : heightScale;
  }

  function proportionalSize(startWidth: number, startHeight: number, scale: number): { height: number; width: number } {
    const safeWidth = Math.max(startWidth, CANVAS_MEDIA_MIN_WIDTH);
    const safeHeight = Math.max(startHeight, CANVAS_MEDIA_MIN_HEIGHT);
    const minimumScale = Math.max(
      CANVAS_MEDIA_MIN_WIDTH / safeWidth,
      CANVAS_MEDIA_MIN_HEIGHT / safeHeight,
    );
    const maximumScale = Math.min(
      Math.max(CANVAS_MEDIA_MIN_WIDTH, Math.min(CANVAS_MEDIA_MAX_WIDTH, maxWidth)) / safeWidth,
      Math.max(CANVAS_MEDIA_MIN_HEIGHT, Math.min(CANVAS_MEDIA_MAX_HEIGHT, maxHeight)) / safeHeight,
    );
    const nextScale = clamp(scale, minimumScale, Math.max(minimumScale, maximumScale));
    return {
      height: Math.round(safeHeight * nextScale),
      width: Math.round(safeWidth * nextScale),
    };
  }

  function toggleAudio() {
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }

  function seekAudio(event: Event) {
    if (!audio) return;
    const value = Number((event.currentTarget as HTMLInputElement).value);
    audio.currentTime = Number.isFinite(value) ? value : 0;
    audioTime = audio.currentTime;
  }

  function setAudioVolume(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    audioVolume = Number.isFinite(value) ? clamp(value, 0, 1) : 1;
    if (audio) audio.volume = audioVolume;
  }

  function formatTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const seconds = Math.floor(value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function style(): string {
    const size = resizedSize ?? { height: element.height, width: element.width };
    return `left:${element.x}px;top:${element.y}px;width:${size.width}px;height:${size.height}px`;
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest(
      'button, input, select, textarea, [contenteditable="true"], [data-media-control], media-player, media-provider, media-video-layout',
    ));
  }

  function isDragHandle(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('[data-media-drag-handle]'));
  }

  function isImageTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('.canvas-media-image'));
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
  }

  type ResizeGesture = {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startHeight: number;
    startWidth: number;
  };

  type PendingMove = {
    pointerId: number;
    startClientX: number;
    startClientY: number;
  };
</script>

<div
  class="canvas-media"
  class:canvas-media--selected={selected}
  class:canvas-media--moving={moving}
  data-canvas-element-id={element.id}
  style={style()}
  role="group"
  aria-label={`${element.kind} ${element.name}`}
  onpointerdown={startInteraction}
  onpointermove={continueInteraction}
  onpointerup={finishInteraction}
  onpointercancel={finishInteraction}
  oncontextmenu={onContextMenu}
>
  {#if loadState === 'loading'}
    <div class="canvas-media-loading" aria-label="Loading media"><span></span></div>
  {:else if loadState === 'error' || !mediaUrl}
    <div class="canvas-media-error">Media unavailable</div>
  {:else if element.kind === 'image' || element.kind === 'gif'}
    <button
      class="canvas-media-image"
      type="button"
      aria-label={`Open ${element.name}`}
      onclick={handleImageClick}
    >
      <img src={mediaUrl} alt={element.name} decoding="async" draggable="false" />
    </button>
  {:else if element.kind === 'video'}
    <div class="canvas-media-video" role="group">
      <KaordoVideoPlayer active={!moving} mimeType={element.mimeType} preload="metadata" src={mediaUrl} title={element.name} />
      <button class="media-drag-handle" data-media-drag-handle type="button" aria-label="Move video" title="Drag to move" onpointerdown={startHandleMove}>⠿</button>
    </div>
  {:else}
    <div class="canvas-media-audio" role="group">
      <audio
        bind:this={audio}
        src={mediaUrl}
        preload="metadata"
        onloadedmetadata={() => audioDuration = audio?.duration ?? 0}
        ontimeupdate={() => audioTime = audio?.currentTime ?? 0}
        onplay={() => audioPlaying = true}
        onpause={() => audioPlaying = false}
        onended={() => { audioPlaying = false; audioTime = 0; }}
      ></audio>
      <button class="audio-play" type="button" aria-label={audioPlaying ? 'Pause audio' : 'Play audio'} onclick={toggleAudio}>
        {audioPlaying ? '❚❚' : '▶'}
      </button>
      <div class="audio-copy"><strong>{element.name}</strong><span>{formatTime(audioTime)} / {formatTime(audioDuration)}</span></div>
      <input class="audio-timeline" type="range" min="0" max={audioDuration || 0} step="0.01" value={audioTime} aria-label="Audio timeline" oninput={seekAudio} />
      <label class="audio-volume" title="Volume">
        <span aria-hidden="true">🔊</span>
        <input type="range" min="0" max="1" step="0.01" value={audioVolume} aria-label="Audio volume" oninput={setAudioVolume} />
      </label>
      <button class="media-drag-handle" data-media-drag-handle type="button" aria-label="Move audio" title="Drag to move" onpointerdown={startHandleMove}>⠿</button>
    </div>
  {/if}

  {#if selected && !moving && element.kind !== 'audio'}
    <button
      class="media-resize-handle"
      type="button"
      aria-label="Resize media"
      title="Drag to resize · Arrow keys resize"
      onpointerdown={startResize}
      onpointermove={continueResize}
      onpointerup={finishResize}
      onpointercancel={finishResize}
      onkeydown={resizeWithKeyboard}
    >↘</button>
  {/if}
</div>

{#if showPhotoViewer && mediaUrl}
  <PhotoViewer
    alt={element.name}
    height={element.height}
    name={element.name}
    onClose={() => showPhotoViewer = false}
    url={mediaUrl}
    width={element.width}
  />
{/if}

<style>
  .canvas-media {
    position: absolute;
    z-index: 3;
    box-sizing: border-box;
    overflow: visible;
    border: 1px solid transparent;
    border-radius: 10px;
    cursor: grab;
    pointer-events: auto;
    touch-action: none;
  }

  .canvas-media:hover,
  .canvas-media--selected {
    border-color: rgb(77 128 110 / 30%);
    box-shadow: 0 8px 22px rgb(37 66 54 / 12%);
  }

  .canvas-media--selected { outline: 2px solid rgb(47 117 96 / 34%); outline-offset: 2px; }
  .canvas-media--moving { opacity: 0; }
  .canvas-media-loading,
  .canvas-media-error,
  .canvas-media-image,
  .canvas-media-video,
  .canvas-media-audio { width: 100%; height: 100%; border-radius: 9px; }
  .canvas-media-loading { display: grid; background: linear-gradient(110deg, #e8efeb 28%, #f8fbf9 42%, #e8efeb 56%); background-size: 200% 100%; animation: media-shimmer 1.2s linear infinite; place-items: center; }
  .canvas-media-loading span { width: 22px; height: 22px; border: 2px solid rgb(63 120 101 / 25%); border-top-color: #4b8b76; border-radius: 50%; animation: media-spin 700ms linear infinite; }
  .canvas-media-error { display: grid; color: #9d5b55; background: #f8e9e7; font-size: calc(11px * var(--text-scale)); place-items: center; }
  .canvas-media-image { display: block; padding: 0; overflow: hidden; background: #edf2ef; border: 0; cursor: zoom-in; }
  .canvas-media-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .canvas-media-video { overflow: hidden; background: #172620; }
  .canvas-media-video :global(.kaordo-video-player) { min-height: 0; }
  .canvas-media-audio { position: relative; display: grid; grid-template-columns: 32px minmax(56px, .85fr) minmax(72px, 1.45fr) minmax(54px, .8fr); align-items: center; gap: 9px; padding: 10px 12px; color: #355f50; background: linear-gradient(135deg, #edf6f1, #f7faf8); border: 1px solid #c5ddd2; cursor: grab; }
  .canvas-media-audio audio { display: none; }
  .audio-play { display: grid; width: 30px; height: 30px; padding: 0; color: white; background: #438673; border: 0; border-radius: 50%; cursor: pointer; font-size: 11px; place-items: center; }
  .audio-copy { min-width: 0; }
  .audio-copy strong, .audio-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .audio-copy strong { font-size: calc(11px * var(--text-scale)); }
  .audio-copy span { margin-top: 3px; color: #7b9187; font-size: calc(9px * var(--text-scale)); font-variant-numeric: tabular-nums; }
  .audio-timeline { width: 100%; accent-color: #4b8b76; }
  .audio-volume { display: flex; min-width: 0; align-items: center; gap: 4px; color: #6e9182; font-size: 11px; }
  .audio-volume input { width: 100%; min-width: 0; accent-color: #4b8b76; }
  .media-drag-handle { position: absolute; top: 8px; left: 8px; z-index: 2; display: grid; width: 26px; height: 26px; padding: 0; color: #fff; background: rgb(24 53 42 / 72%); border: 1px solid rgb(255 255 255 / 65%); border-radius: 7px; cursor: grab; font-size: 15px; place-items: center; opacity: .8; }
  .media-drag-handle:active { cursor: grabbing; }
  .canvas-media-video .media-drag-handle { opacity: 0; transition: opacity 140ms ease; }
  .canvas-media-video:hover .media-drag-handle,
  .canvas-media--selected .media-drag-handle { opacity: .9; }
  .media-resize-handle { position: absolute; right: -10px; bottom: -10px; display: grid; width: 22px; height: 22px; padding: 0; color: #fff; background: #4b8b76; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 2px 8px rgb(25 60 47 / 20%); cursor: nwse-resize; font-size: 13px; place-items: center; }
  @keyframes media-shimmer { to { background-position: -200% 0; } }
  @keyframes media-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .canvas-media-loading, .canvas-media-loading span { animation: none; } }
</style>
