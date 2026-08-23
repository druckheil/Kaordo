<script lang="ts">
  import type { CanvasService } from '../../lib/services/CanvasService';
  import { canvasMediaKind } from '../../lib/features/canvasMedia';
  import type { CanvasSnapshot, CanvasTool } from '../../lib/states/CanvasGState';

  type Props = {
    canvas: CanvasService;
    placedCount: number;
    snapshot: Readonly<CanvasSnapshot>;
    workspaceId: string;
  };

  let { canvas, placedCount, snapshot, workspaceId }: Props = $props();
  let mediaInput = $state<HTMLInputElement>();
  let zoom = $derived(snapshot.zooms[workspaceId] ?? 1);
  let selectedElement = $derived.by(() => {
    snapshot.selectedGlobalElementId;
    return canvas.selectedCanvasElement();
  });
  const fills = ['#ffffff', '#dcece5', '#dce8f6', '#f8e7bf', '#f3deda', '#ede2f5'];
  const strokes = ['#397565', '#436c9e', '#967033', '#9a5148', '#76528e'];
  const textColors = ['#25332d', '#376f60', '#3f6591', '#9a5148', '#76528e'];
  const highlights = ['#fff1a8', '#dcece5', '#dce8f6', '#f3deda', 'transparent'];
  const leftBarOptions = [0, 1, 2] as const;

  function chooseTool(tool: CanvasTool) {
    canvas.state.setTool(tool);
  }

  async function chooseMedia(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const dimensions = await Promise.all(files.map(readMediaDimensions));
    try {
      await canvas.addCanvasMediaFiles(workspaceId, files, dimensions);
    } catch {
      canvas.state.announce('Media could not be added to the canvas.');
    }
  }

  function readMediaDimensions(file: File): Promise<{ height: number; width: number } | undefined> {
    const kind = canvasMediaKind(file);
    if (!kind || kind === 'audio') return Promise.resolve(undefined);
    const url = URL.createObjectURL(file);
    return new Promise((resolve) => {
      const cleanup = () => URL.revokeObjectURL(url);
      const timeout = window.setTimeout(() => { cleanup(); resolve(undefined); }, 1200);
      if (kind === 'video') {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          window.clearTimeout(timeout);
          const result = video.videoWidth > 0 && video.videoHeight > 0
            ? { height: video.videoHeight, width: video.videoWidth }
            : undefined;
          cleanup();
          resolve(result);
        };
        video.onerror = () => { window.clearTimeout(timeout); cleanup(); resolve(undefined); };
        video.src = url;
        return;
      }
      const image = new Image();
      image.onload = () => {
        window.clearTimeout(timeout);
        const result = image.naturalWidth > 0 && image.naturalHeight > 0
          ? { height: image.naturalHeight, width: image.naturalWidth }
          : undefined;
        cleanup();
        resolve(result);
      };
      image.onerror = () => { window.clearTimeout(timeout); cleanup(); resolve(undefined); };
      image.src = url;
    });
  }
</script>

<div class="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
  <span class="canvas-toolbar-title">Canvas</span>
  <span class="canvas-toolbar-separator" aria-hidden="true"></span>

  <div class="tool-group" aria-label="Tools">
    <button
      class:tool-button--active={snapshot.activeTool === 'select'}
      class="tool-button"
      type="button"
      aria-label="Select tool"
      aria-pressed={snapshot.activeTool === 'select'}
      title="Select and move"
      onclick={() => chooseTool('select')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="m5 3 9 8-4 .7-2.2 3.7z" />
      </svg>
    </button>
    <button
      class="tool-button"
      type="button"
      aria-label="Add media"
      title="Attach image, GIF, video, or audio"
      disabled={!snapshot.isCanvasDocumentReady}
      onclick={() => mediaInput?.click()}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="4" width="14" height="12" rx="2" />
        <circle cx="7" cy="8" r="1.2" />
        <path d="m4.5 14 3.5-3.5 2.5 2 2-2 3 3.5" />
      </svg>
    </button>
    <input
      class="media-input"
      bind:this={mediaInput}
      type="file"
      accept="image/*,video/*,audio/*"
      multiple
      onchange={chooseMedia}
      aria-label="Choose canvas media"
    />
    <button
      class:tool-button--active={snapshot.activeTool === 'rectangle'}
      class="tool-button"
      type="button"
      aria-label="Card tool"
      aria-pressed={snapshot.activeTool === 'rectangle'}
      title="Draw card"
      onclick={() => chooseTool('rectangle')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3.5" y="4.5" width="13" height="11" rx="2" />
      </svg>
    </button>
    <button
      class:tool-button--active={snapshot.activeTool === 'text'}
      class="tool-button tool-button--text"
      type="button"
      aria-label="Text tool"
      aria-pressed={snapshot.activeTool === 'text'}
      title="Add text"
      onclick={() => chooseTool('text')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 4.5h12M10 4.5v11M7.5 15.5h5" />
      </svg>
    </button>
  </div>

  <span class="canvas-toolbar-separator" aria-hidden="true"></span>

  {#if selectedElement?.type === 'text'}
    <div class="tool-group text-format-group" aria-label="Text style">
      {#each [
        ['bold', 'Bold', 'B'],
        ['italic', 'Italic', 'I'],
        ['underline', 'Underline', 'U'],
        ['strikeThrough', 'Strikethrough', 'S'],
      ] as format}
        <button
          class="format-button format-button--{format[0]}"
          type="button"
          aria-label={format[1]}
          title={format[1]}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => void canvas.formatSelectedText(format[0] as 'bold' | 'italic' | 'underline' | 'strikeThrough')}
        >{format[2]}</button>
      {/each}
    </div>

    <div class="style-group size-group" aria-label="Font size">
      <span>Size</span>
      {#each [12, 16, 20, 28] as size}
        <button
          class:format-button--active={selectedElement.fontSize === size}
          class="format-button size-button"
          type="button"
          aria-label={`Font size ${size}`}
          title={`${size}px`}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => void canvas.setTextFontSize(size)}
        >{size}</button>
      {/each}
    </div>

    <div class="tool-group" aria-label="Text alignment">
      {#each ['left', 'center', 'right'] as alignment}
        <button
          class:format-button--active={selectedElement.textAlign === alignment}
          class="format-button align-button"
          type="button"
          aria-label={`Align ${alignment}`}
          title={`Align ${alignment}`}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => void canvas.setTextAlignment(alignment as 'left' | 'center' | 'right')}
        >
          <i class="align-icon align-icon--{alignment}" aria-hidden="true"><span></span><span></span><span></span></i>
        </button>
      {/each}
    </div>

    <div class="tool-group" aria-label="Left bars">
      {#each leftBarOptions as option}
        <button
          class:format-button--active={(selectedElement.leftBars ?? 0) === option}
          class="format-button bars-button"
          type="button"
          aria-label={option === 0 ? 'No left bars' : `${option} left bars`}
          aria-pressed={(selectedElement.leftBars ?? 0) === option}
          title={option === 0 ? 'No left bars' : `${option} left bars`}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => void canvas.setTextLeftBars(option === 0 ? null : option)}
        >
          <span class="left-bars-icon" aria-hidden="true">
            {#if option > 0}<i></i>{/if}
            {#if option > 1}<i></i>{/if}
          </span>
        </button>
      {/each}
    </div>

    <div class="style-group" aria-label="Text color">
      <span>Text</span>
      {#each textColors as color}
        <button
          class="color-button color-button--text"
          type="button"
          aria-label={`Text color ${color}`}
          title={`Text color ${color}`}
          style={`--color: ${color}`}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => void canvas.formatSelectedText('foreColor', color)}
        ></button>
      {/each}
    </div>

    <div class="style-group" aria-label="Text highlight">
      <span>Highlight</span>
      {#each highlights as color}
        <button
          class="color-button color-button--highlight"
          type="button"
          aria-label={color === 'transparent' ? 'Remove highlight' : `Highlight ${color}`}
          title={color === 'transparent' ? 'Remove highlight' : `Highlight ${color}`}
          style={`--color: ${color}`}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => void canvas.formatSelectedText('hiliteColor', color)}
        ></button>
      {/each}
    </div>
  {:else if snapshot.activeTool === 'text'}
    <span class="text-tool-hint">Click anywhere to add text</span>
  {:else}
    <div class="style-group" aria-label="Card fill">
      <span>Fill</span>
      {#each fills as color}
        <button
          class:color-button--active={snapshot.shapeFill === color}
          class="color-button"
          type="button"
          aria-label={`Fill ${color}`}
          aria-pressed={snapshot.shapeFill === color}
          style={`--color: ${color}`}
          onclick={() => void canvas.setRectangleFill(color)}
        ></button>
      {/each}
    </div>

    <div class="style-group" aria-label="Card outline">
      <span>Stroke</span>
      {#each strokes as color}
        <button
          class:color-button--active={snapshot.shapeStroke === color}
          class="color-button color-button--stroke"
          type="button"
          aria-label={`Stroke ${color}`}
          aria-pressed={snapshot.shapeStroke === color}
          style={`--color: ${color}`}
          onclick={() => void canvas.setRectangleStroke(color)}
        ></button>
      {/each}
    </div>
  {/if}

  <span class="canvas-toolbar-status">
    {selectedElement?.type === 'text'
      ? snapshot.editingTextId ? 'Editing text' : 'Text selected'
      : selectedElement?.type === 'media'
        ? 'Media selected'
      : snapshot.selectedGlobalElementId
        ? 'Card selected'
      : snapshot.selectedCardId
        ? 'Card selected'
        : `${placedCount} placed`}
  </span>

  <span class="canvas-toolbar-separator" aria-hidden="true"></span>
  <div class="zoom-group" aria-label="Canvas zoom">
    <button
      class="zoom-button"
      type="button"
      aria-label="Zoom out"
      title="Zoom out"
      onclick={() => canvas.zoomOut()}
    >−</button>
    <button
      class="zoom-value"
      type="button"
      aria-label={`Reset zoom, currently ${Math.round(zoom * 100)}%`}
      title="Reset zoom"
      onclick={() => canvas.resetZoom()}
    >{Math.round(zoom * 100)}%</button>
    <button
      class="zoom-button"
      type="button"
      aria-label="Zoom in"
      title="Zoom in"
      onclick={() => canvas.zoomIn()}
    >+</button>
  </div>
</div>

<style>
  .canvas-toolbar {
    position: absolute;
    top: 13px;
    left: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 32px);
    min-height: 38px;
    padding: 4px 8px 4px 11px;
    color: #68736c;
    background: rgb(250 252 249 / 92%);
    border: 1px solid rgb(190 204 196 / 84%);
    border-radius: 10px;
    box-shadow:
      0 10px 28px rgb(35 57 48 / 10%),
      inset 0 1px rgb(255 255 255 / 88%);
    backdrop-filter: blur(14px);
    overflow-x: auto;
    scrollbar-width: none;
    font-size: calc(10px * var(--text-scale));
    font-weight: 600;
    animation: canvas-overlay-enter 280ms ease-out both;
  }

  .canvas-toolbar::-webkit-scrollbar { display: none; }
  .media-input { display: none; }
  .tool-button:disabled { cursor: not-allowed; opacity: 0.45; }

  .canvas-toolbar-title { color: #345d51; font-weight: 720; }
  .canvas-toolbar-separator { width: 1px; height: 19px; background: #d3dbd6; }
  .tool-group, .style-group { display: flex; align-items: center; gap: 3px; }

  .tool-button, .color-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    color: #5f6c65;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }

  .tool-button:hover, .tool-button--active {
    color: #285f50;
    background: #e5f0eb;
    border-color: #b9d0c6;
  }

  .tool-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linejoin: round; stroke-width: 1.5; }
  .tool-button:first-child svg { fill: currentColor; stroke-width: 1; }
  .tool-button--text svg { stroke-linecap: round; }

  .format-button {
    display: grid;
    min-width: 25px;
    height: 27px;
    padding: 0 6px;
    color: #59675f;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: calc(10px * var(--text-scale));
    font-weight: 650;
    place-items: center;
  }

  .format-button:hover,
  .format-button--active {
    color: #285f50;
    background: #e5f0eb;
    border-color: #b9d0c6;
  }

  .format-button--italic { font-style: italic; }
  .format-button--underline { text-decoration: underline; }
  .format-button--strikeThrough { text-decoration: line-through; }
  .format-button:focus-visible { outline: 2px solid rgb(55 117 102 / 35%); outline-offset: 1px; }
  .text-format-group { padding-right: 2px; }
  .text-tool-hint { padding: 0 5px; color: #6f7e76; font-size: calc(10px * var(--text-scale)); font-weight: 560; white-space: nowrap; }
  .size-group { gap: 2px; }
  .size-button { min-width: 27px; padding: 0 3px; font-variant-numeric: tabular-nums; }

  .align-icon {
    display: grid;
    align-content: center;
    gap: 2px;
    width: 12px;
    height: 12px;
  }

  .align-icon span { display: block; height: 1px; background: currentColor; }
  .align-icon span:nth-child(2) { width: 8px; }
  .align-icon--center span:nth-child(2) { justify-self: center; }
  .align-icon--right span:nth-child(2) { justify-self: end; }

  .bars-button { min-width: 28px; }
  .left-bars-icon { display: flex; gap: 3px; width: 12px; height: 14px; justify-content: center; }
  .left-bars-icon i { width: 2px; height: 14px; background: currentColor; border-radius: 999px; }

  .style-group { gap: 4px; margin-left: 1px; }
  .style-group > span { margin-right: 1px; color: #7a867f; font-size: calc(9px * var(--text-scale)); }
  .color-button { width: 18px; height: 24px; }
  .color-button::after { width: 12px; height: 12px; background: var(--color); border: 1px solid rgb(47 66 57 / 18%); border-radius: 4px; content: ""; }
  .color-button--stroke::after { box-sizing: border-box; background: #fff; border: 3px solid var(--color); }
  .color-button--text::after { border-radius: 50%; }
  .color-button--highlight::after { background: var(--color); border-radius: 2px; box-shadow: inset 0 -3px rgb(64 73 68 / 14%); }
  .color-button--highlight:last-child::after { background: linear-gradient(135deg, transparent 45%, #b9564d 46%, #b9564d 54%, transparent 55%); }
  .color-button:hover, .color-button--active { background: #edf3ef; border-color: #c5d5cd; }
  .tool-button:focus-visible, .color-button:focus-visible { outline: 2px solid rgb(55 117 102 / 35%); outline-offset: 1px; }

  .canvas-toolbar-status {
    min-width: 68px;
    padding: 0 4px;
    color: #849089;
    text-align: right;
    white-space: nowrap;
  }

  .zoom-group { display: flex; align-items: center; gap: 2px; }

  .zoom-button,
  .zoom-value {
    height: 26px;
    padding: 0;
    color: #5c6b63;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }

  .zoom-button { width: 24px; font-size: calc(15px * var(--text-scale)); font-weight: 500; }
  .zoom-value { min-width: 43px; padding: 0 4px; font-size: calc(9px * var(--text-scale)); font-variant-numeric: tabular-nums; }
  .zoom-button:hover, .zoom-value:hover { color: #285f50; background: #e5f0eb; border-color: #b9d0c6; }
  .zoom-button:focus-visible, .zoom-value:focus-visible { outline: 2px solid rgb(55 117 102 / 35%); outline-offset: 1px; }

  @keyframes canvas-overlay-enter {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .canvas-toolbar { animation: none; }
  }
</style>
