<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    sanitizeTextHtml,
    textElementLabel,
    type TextElement,
  } from '../../lib/domain/workspace';
  import type {
    CanvasService,
    TextFormatCommand,
  } from '../../lib/services/CanvasService';
  import { canvasApplicationScale } from '../../lib/features/canvas';
  import { openContextMenu } from '../../lib/ui/contextMenu';

  type Props = {
    canvas: CanvasService;
    editing: boolean;
    element: TextElement;
    maxWidth?: number;
    moving?: boolean;
    onStartMove: (event: PointerEvent, element: TextElement) => void;
    selected: boolean;
    workspaceId: string;
  };

  let {
    canvas,
    editing,
    element,
    maxWidth = 900,
    moving = false,
    onStartMove,
    selected,
    workspaceId,
  }: Props = $props();
  let editor = $state<HTMLDivElement>();
  let elementId = $derived(element.id);
  let draftHtml = $state('');
  let savedRange: Range | null = null;
  let autosaveTimer: number | null = null;
  let lastPointerDown: { at: number; id: string } | null = null;
  let resize = $state<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
  } | null>(null);
  let resizedWidth = $state<number | null>(null);

  onDestroy(() => {
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
      void persistDraft(false);
    }
  });

  $effect(() => {
    if (!editing) {
      draftHtml = element.html;
      return;
    }
    const controller = { format };
    canvas.attachTextEditor(elementId, controller);
    void tick().then(() => {
      editor?.focus({ preventScroll: true });
      if (!draftHtml) document.execCommand('selectAll', false);
      rememberSelection();
    });
    return () => canvas.attachTextEditor(elementId, null);
  });

  function startInteraction(event: PointerEvent) {
    event.stopPropagation();
    if (editing) return;
    const now = performance.now();
    const isDoubleClick = event.detail >= 2 || (
      lastPointerDown?.id === element.id &&
      now - lastPointerDown.at <= 450
    );
    lastPointerDown = isDoubleClick
      ? null
      : { at: now, id: element.id };
    if (isDoubleClick) {
      beginEditing(event);
      return;
    }
    onStartMove(event, element);
  }

  function beginEditing(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    canvas.state.editText(element.id);
  }

  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    resize = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: element.width,
    };
    resizedWidth = element.width;
  }

  function continueResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const applicationScale = canvasApplicationScale();
    resizedWidth = clamp(
      resize.startWidth +
        (event.clientX - resize.startClientX) /
          applicationScale /
          canvas.currentZoom(),
      100,
      Math.max(100, maxWidth),
    );
  }

  function finishResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const width = Math.round(resizedWidth ?? element.width);
    resize = null;
    resizedWidth = null;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture?.(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    void canvas.updateCanvasElement(workspaceId, { ...element, width })
      .catch(() => canvas.state.announce('Text width could not be saved.'));
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const delta = (event.shiftKey ? 40 : 12) * (event.key === 'ArrowRight' ? 1 : -1);
    const width = Math.round(clamp(element.width + delta, 100, Math.max(100, maxWidth)));
    void canvas.updateCanvasElement(workspaceId, { ...element, width })
      .catch(() => canvas.state.announce('Text width could not be saved.'));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!editing && (event.key === 'Enter' || event.key === ' ')) {
      beginEditing(event);
      return;
    }
    if (!editing) return;
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      void finishEditing();
    }
  }

  function handleInput() {
    draftHtml = editor?.innerHTML ?? '';
    rememberSelection();
    if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      void persistDraft(false);
    }, 350);
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    const rich = event.clipboardData?.getData('text/html');
    const plain = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand(
      rich ? 'insertHTML' : 'insertText',
      false,
      rich ? sanitizeTextHtml(rich) : plain,
    );
    handleInput();
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRange = range.cloneRange();
    }
  }

  function format(command: TextFormatCommand, value?: string) {
    if (!editor) return;
    editor.focus({ preventScroll: true });
    if (savedRange) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange);
    }
    document.execCommand(command, false, value);
    draftHtml = editor.innerHTML;
    rememberSelection();
    void persistDraft(false);
  }

  async function finishEditing() {
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    await persistDraft(true);
    canvas.state.editText(null);
  }

  async function persistDraft(measure: boolean) {
    const html = sanitizeTextHtml(editor?.innerHTML ?? draftHtml);
    const height = measure
      ? Math.max(48, Math.ceil((editor?.scrollHeight ?? element.height) + 4))
      : element.height;
    try {
      await canvas.updateCanvasElement(workspaceId, {
        ...element,
        height,
        html,
      });
      draftHtml = html;
    } catch {
      canvas.state.announce('Text changes could not be saved.');
    }
  }

  function style(element: TextElement): string {
    return [
      `left:${element.x}px`,
      `top:${element.y}px`,
      `width:${resizedWidth ?? element.width}px`,
      `min-height:${element.height}px`,
      `color:${element.color}`,
      `font-size:${element.fontSize}px`,
      `text-align:${element.textAlign}`,
    ].join(';');
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }
</script>

<div
  class="canvas-text-block"
  class:canvas-text-block--editing={editing}
  class:canvas-text-block--bars-one={element.leftBars === 1}
  class:canvas-text-block--bars-two={element.leftBars === 2}
  class:canvas-text-block--moving={moving}
  class:canvas-text-block--selected={selected}
  data-canvas-element-id={element.id}
  style={style(element)}
  role="button"
  tabindex="0"
  aria-label={`Text: ${textElementLabel(element)}`}
  title={editing ? 'Edit text · Esc or ⌘Enter to finish' : 'Drag to move · Double-click to edit'}
  onpointerdown={startInteraction}
  ondblclick={beginEditing}
  onkeydown={handleKeydown}
  oncontextmenu={(event) => openContextMenu(event, textElementLabel(element), [
    {
      action: () => {
        canvas.state.editText(null);
        canvas.state.selectGlobalElement(element.id);
      },
      icon: 'select',
      id: 'select-text',
      label: 'Select Text',
    },
    {
      action: () => beginEditing(),
      icon: 'edit',
      id: 'edit-text',
      label: 'Edit Text',
    },
    {
      action: () => canvas.deleteCanvasElement(workspaceId, element.id),
      confirmation: 'Delete this text?',
      danger: true,
      icon: 'delete',
      id: 'delete-text',
      label: 'Delete Text',
    },
  ])}
>
  {#if editing}
    <div
      class="canvas-text-editor"
      class:canvas-text-editor--empty={!draftHtml}
      contenteditable="true"
      tabindex="0"
      role="textbox"
      aria-label="Text editor"
      aria-multiline="true"
      data-placeholder="Type something…"
      bind:this={editor}
      bind:innerHTML={draftHtml}
      oninput={handleInput}
      onkeyup={rememberSelection}
      onmouseup={rememberSelection}
      onpaste={handlePaste}
      onblur={() => void finishEditing()}
    ></div>
  {:else}
    <div class="canvas-text-content">
      {#if element.html}
        {@html element.html}
      {:else}
        <span class="canvas-text-placeholder">Untitled text</span>
      {/if}
    </div>
  {/if}
  {#if selected && !editing && !moving}
    <button
      class="text-resize-handle"
      type="button"
      aria-label="Resize text width"
      title="Drag to resize · Arrow keys resize"
      onpointerdown={startResize}
      onpointermove={continueResize}
      onpointerup={finishResize}
      onpointercancel={finishResize}
      onkeydown={resizeWithKeyboard}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 9h8M2 9l2-2M2 9l2 2M10 9 8 7m2 2-2 2" /></svg>
    </button>
  {/if}
</div>

<style>
  .canvas-text-block {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    padding: 7px 9px;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: grab;
    line-height: 1.42;
    overflow-wrap: anywhere;
    pointer-events: auto;
    touch-action: none;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .canvas-text-block:hover,
  .canvas-text-block--selected {
    background: rgb(255 255 255 / 72%);
    border-color: rgb(77 128 110 / 28%);
    box-shadow: 0 6px 18px rgb(37 66 54 / 8%);
  }

  .canvas-text-block--selected {
    outline: 2px solid rgb(47 117 96 / 34%);
    outline-offset: 2px;
  }

  .canvas-text-block--editing {
    z-index: 8;
    background: rgb(255 255 255 / 96%);
    border-color: #6f9f8f;
    box-shadow:
      0 12px 30px rgb(35 67 54 / 14%),
      0 0 0 3px rgb(55 117 102 / 12%);
    cursor: text;
  }

  .canvas-text-block--bars-one::before,
  .canvas-text-block--bars-two::before,
  .canvas-text-block--bars-two::after {
    position: absolute;
    top: 7px;
    bottom: 7px;
    width: 2px;
    background: currentColor;
    border-radius: 999px;
    content: "";
    opacity: 0.68;
    pointer-events: none;
  }

  .canvas-text-block--bars-one::before,
  .canvas-text-block--bars-two::before { left: 3px; }
  .canvas-text-block--bars-two::after { left: 7px; }

  .canvas-text-block--bars-one,
  .canvas-text-block--bars-two { padding-left: 15px; }

  .canvas-text-block--moving {
    opacity: 0;
  }

  .canvas-text-editor,
  .canvas-text-content {
    min-height: 1.5em;
    outline: none;
    white-space: pre-wrap;
  }

  .canvas-text-editor {
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  .canvas-text-editor :global(*) {
    user-select: text;
    -webkit-user-select: text;
  }

  .canvas-text-editor--empty::before {
    color: #9aa59f;
    content: attr(data-placeholder);
    pointer-events: none;
  }

  .canvas-text-placeholder {
    color: #9aa59f;
    font-style: italic;
  }

  .text-resize-handle {
    position: absolute;
    right: -9px;
    bottom: -10px;
    display: grid;
    width: 21px;
    height: 21px;
    padding: 0;
    color: #477d6e;
    background: #f8fbf9;
    border: 1px solid #9dbcae;
    border-radius: 6px;
    box-shadow: 0 4px 10px rgb(35 67 54 / 12%);
    cursor: ew-resize;
    place-items: center;
    touch-action: none;
  }

  .text-resize-handle:hover { background: #e7f1ed; }
  .text-resize-handle:focus-visible { outline: 2px solid rgb(55 117 102 / 36%); outline-offset: 2px; }
  .text-resize-handle svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.15; }

  @media (prefers-reduced-motion: reduce) {
    .canvas-text-block { transition: none; }
  }
</style>
