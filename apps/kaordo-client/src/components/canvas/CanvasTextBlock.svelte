<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    sanitizeTextHtml,
    type TextArrowSource,
    type TextRangeAnchor,
    textElementLabel,
    type TextElement,
  } from '../../lib/domain/workspace';
  import type {
    CanvasService,
    TextFormatCommand,
  } from '../../lib/services/CanvasService';
  import { CANVAS_HEIGHT, canvasApplicationScale } from '../../lib/features/canvas';
  import {
    ALL_TEXT_LAYOUTS,
    measureTextRangeFragments,
    notifyTextLayoutChanged,
    subscribeTextLayoutChanged,
    textOffset,
    textPointAtOffset,
    textWordsForSelection,
  } from '../../lib/features/textLayout';
  import type { TextRangeFrame } from '../../lib/features/textLayout';
  import { openContextMenu } from '../../lib/ui/contextMenu';

  type Props = {
    arrowHighlights?: readonly TextArrowHighlight[];
    canvas: CanvasService;
    arrowSource?: TextArrowSource | null;
    editing: boolean;
    element: TextElement;
    maxHeight?: number;
    maxWidth?: number;
    moving?: boolean;
    onStartMove: (event: PointerEvent, element: TextElement) => void;
    selected: boolean;
    workspaceId: string;
    zoom?: number;
  };

  type TextSelectionBookmark = {
    end: number;
    start: number;
  };

  export type TextArrowHighlight = {
    anchor: TextRangeAnchor;
    color: string;
  };

  const TEXT_BLOCK_MIN_HEIGHT = 48;
  const TEXT_BLOCK_MIN_WIDTH = 100;

  let {
    arrowHighlights = [],
    canvas,
    arrowSource = null,
    editing,
    element,
    maxHeight = CANVAS_HEIGHT,
    maxWidth = 900,
    moving = false,
    onStartMove,
    selected,
    workspaceId,
    zoom = 1,
  }: Props = $props();
  let editor = $state<HTMLDivElement>();
  let elementId = $derived(element.id);
  let draftHtml = $state('');
  let savedRange: Range | null = null;
  let selectionRevision = 0;
  let preservingFormatSelection = false;
  let autosaveTimer: number | null = null;
  let finishing = false;
  let lastPointerDown: { at: number; id: string } | null = null;
  let resize = $state<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startHeight: number;
    startWidth: number;
  } | null>(null);
  let resizedWidth = $state<number | null>(null);
  let resizedHeight = $state<number | null>(null);
  let layoutRefreshFrame: number | null = null;
  let textLayoutRevision = $state(0);
  let textArrowAnchor = $derived(
    arrowSource?.elementId === element.id ? arrowSource.anchor : null,
  );
  let textArrowHighlightEntries = $derived.by(() => {
    const entries = [...arrowHighlights];
    if (
      textArrowAnchor &&
      !entries.some((entry) => sameTextRange(entry.anchor, textArrowAnchor))
    ) {
      entries.unshift({ anchor: textArrowAnchor, color: '#635be0' });
    }
    return entries.map((entry, index) => ({
      ...entry,
      active: textArrowAnchor !== null && sameTextRange(entry.anchor, textArrowAnchor),
      key: `${entry.anchor.startOffset}:${entry.anchor.endOffset}:${index}`,
    }));
  });
  let textArrowHighlightFrames = $derived.by(() => {
    textLayoutRevision;
    return textArrowHighlightEntries.flatMap((entry) => {
      const scale = Math.max(0.0001, canvasApplicationScale() * zoom);
      const frames = editor
        ? measureTextRangeFragments(editor, entry.anchor, scale)
        : null;
      const resolved = frames?.length
        ? frames
        : [fallbackTextRangeFrame(entry.anchor)];
      return resolved.map((frame, index) => ({
        ...entry,
        frame,
        key: `${entry.key}:${index}`,
      }));
    });
  });

  onMount(() => {
    const notify = () => {
      notifyTextLayoutChanged(element.id);
    };
    const unsubscribe = subscribeTextLayoutChanged((changedElementId) => {
      if (changedElementId === ALL_TEXT_LAYOUTS || changedElementId === element.id) {
        textLayoutRevision += 1;
      }
    });
    const block = editor?.closest<HTMLElement>('.canvas-text-block') ?? editor;
    const observer = typeof ResizeObserver === 'function' && block
      ? new ResizeObserver(notify)
      : null;
    if (observer && block) observer.observe(block);
    notify();
    return () => {
      observer?.disconnect();
      unsubscribe();
    };
  });

  onDestroy(() => {
    if (layoutRefreshFrame !== null) {
      window.cancelAnimationFrame?.(layoutRefreshFrame);
      layoutRefreshFrame = null;
    }
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
      void persistDraft(false);
    }
  });

  $effect(() => {
    if (editor) editor.contentEditable = editing ? 'true' : 'false';
    if (!editing) {
      draftHtml = element.html;
      savedRange = null;
      void tick().then(() => notifyTextLayoutChanged(element.id));
      return;
    }
    const controller = {
      commit: () => persistDraft(true),
      format,
      getTextAnchor: textAnchor,
    };
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
      startClientY: event.clientY,
      startHeight: element.height,
      startWidth: element.width,
    };
    resizedWidth = element.width;
    resizedHeight = element.height;
  }

  function continueResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const applicationScale = canvasApplicationScale();
    const scale = Math.max(0.0001, applicationScale * canvas.currentZoom());
    resizedWidth = clamp(
      resize.startWidth +
        (event.clientX - resize.startClientX) / scale,
      TEXT_BLOCK_MIN_WIDTH,
      Math.max(TEXT_BLOCK_MIN_WIDTH, maxWidth),
    );
    resizedHeight = clamp(
      resize.startHeight + (event.clientY - resize.startClientY) / scale,
      TEXT_BLOCK_MIN_HEIGHT,
      Math.max(TEXT_BLOCK_MIN_HEIGHT, maxHeight),
    );
    scheduleTextLayoutRefresh();
  }

  function finishResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const width = Math.round(resizedWidth ?? element.width);
    const height = Math.round(resizedHeight ?? element.height);
    resize = null;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture?.(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    void canvas.updateCanvasElement(workspaceId, { ...element, height, width })
      .then(() => {
        resizedWidth = null;
        resizedHeight = null;
        scheduleTextLayoutRefresh();
      })
      .catch(() => {
        resizedWidth = null;
        resizedHeight = null;
        canvas.state.announce('Text block size could not be saved.');
        scheduleTextLayoutRefresh();
      });
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (!horizontal && !vertical) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.shiftKey ? 40 : 12;
    const width = horizontal
      ? Math.round(clamp(
          element.width + delta * (event.key === 'ArrowRight' ? 1 : -1),
          TEXT_BLOCK_MIN_WIDTH,
          Math.max(TEXT_BLOCK_MIN_WIDTH, maxWidth),
        ))
      : element.width;
    const height = vertical
      ? Math.round(clamp(
          element.height + delta * (event.key === 'ArrowDown' ? 1 : -1),
          TEXT_BLOCK_MIN_HEIGHT,
          Math.max(TEXT_BLOCK_MIN_HEIGHT, maxHeight),
        ))
      : element.height;
    void canvas.updateCanvasElement(workspaceId, { ...element, height, width })
      .then(() => scheduleTextLayoutRefresh())
      .catch(() => canvas.state.announce('Text block size could not be saved.'));
  }

  function scheduleTextLayoutRefresh(): void {
    if (typeof window === 'undefined') return;
    if (typeof window.requestAnimationFrame !== 'function') {
      notifyTextLayoutChanged(element.id);
      return;
    }
    if (layoutRefreshFrame !== null) return;
    layoutRefreshFrame = window.requestAnimationFrame(() => {
      layoutRefreshFrame = null;
      notifyTextLayoutChanged(element.id);
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!editing && (event.key === 'Enter' || event.key === ' ')) {
      beginEditing(event);
      return;
    }
    if (!editing) return;
    const shortcut = textFormatShortcut(event);
    if (shortcut) {
      event.preventDefault();
      event.stopPropagation();
      format(shortcut);
      return;
    }
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      void finishEditing();
    }
  }

  function textFormatShortcut(event: KeyboardEvent): TextFormatCommand | null {
    if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return null;
    const key = event.key.toLowerCase();
    if (key === 'b' && !event.shiftKey) return 'bold';
    if (key === 'i' && !event.shiftKey) return 'italic';
    if (key === 'u' && !event.shiftKey) return 'underline';
    if (key === 'x' && event.shiftKey) return 'strikeThrough';
    return null;
  }

  function handleInput() {
    if (!editing) return;
    draftHtml = editor?.innerHTML ?? '';
    notifyTextLayoutChanged(element.id);
    if (!preservingFormatSelection) rememberSelection();
    if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      void persistDraft(false);
    }, 350);
  }

  function handlePaste(event: ClipboardEvent) {
    if (!editing) return;
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
    if (!editing || !editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRange = range.cloneRange();
      selectionRevision += 1;
    }
  }

  function selectionBookmark(range: Range): TextSelectionBookmark | null {
    if (!editor) return null;
    const start = textOffset(editor, range.startContainer, range.startOffset);
    const end = textOffset(editor, range.endContainer, range.endOffset);
    if (start === null || end === null) return null;
    return {
      end: Math.max(start, end),
      start: Math.min(start, end),
    };
  }

  function textAnchor(): TextRangeAnchor | null {
    if (!editor) return null;
    const range = savedRange ?? currentSelectionRange();
    if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) {
      return null;
    }
    const text = editor.textContent ?? '';
    const start = textOffset(editor, range.startContainer, range.startOffset);
    const end = textOffset(editor, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return null;
    const rawQuote = text.slice(start, end);
    const leadingWhitespace = rawQuote.search(/\S|$/);
    const trailingWhitespace = rawQuote.length - rawQuote.replace(/\s+$/, '').length;
    const startOffset = start + leadingWhitespace;
    const endOffset = Math.max(startOffset, end - trailingWhitespace);
    const quote = text.slice(startOffset, endOffset).replace(/\s+/g, ' ').trim();
    if (!quote) return null;

    const block = editor.closest<HTMLElement>('.canvas-text-block');
    const blockRect = block?.getBoundingClientRect() ?? editor.getBoundingClientRect();
    const selectionRect = typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : {
          bottom: blockRect.top,
          height: 0,
          left: blockRect.left,
          right: blockRect.left,
          top: blockRect.top,
          width: 0,
        };
    const scale = Math.max(0.0001, canvasApplicationScale() * zoom);
    const logicalHeight = Math.max(element.height, editor.scrollHeight || 0);
    const fallbackWidth = Math.max(1, Math.min(element.width, quote.length * element.fontSize * 0.56));
    const x = clamp((selectionRect.left - blockRect.left) / scale, 0, element.width);
    const y = clamp((selectionRect.top - blockRect.top) / scale, 0, logicalHeight);
    const width = Math.max(
      1,
      Math.min(
        Math.max(1, element.width - x),
        selectionRect.width > 0 ? selectionRect.width / scale : fallbackWidth,
      ),
    );
    const height = Math.max(
      1,
      Math.min(
        Math.max(1, logicalHeight - y),
        selectionRect.height > 0 ? selectionRect.height / scale : element.fontSize * 1.42,
      ),
    );
    return {
      endOffset,
      height,
      quote,
      startOffset,
      words: textWordsForSelection(text, startOffset, endOffset, element.id),
      width,
      x,
      y,
    };
  }

  function currentSelectionRange(): Range | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor?.contains(range.commonAncestorContainer) ? range : null;
  }

  function format(command: TextFormatCommand, value?: string) {
    if (!editor) return;
    const selectionRange = savedRange && editor.contains(savedRange.commonAncestorContainer)
      ? savedRange.cloneRange()
      : currentSelectionRange()?.cloneRange() ?? null;
    const selection = selectionRange ? selectionBookmark(selectionRange) : null;
    const formatRevision = selectionRevision;
    editor.focus({ preventScroll: true });
    if (!restoreSelection(selectionRange) && selection) restoreSelectionBookmark(selection);
    preservingFormatSelection = true;
    try {
      document.execCommand(command, false, value);
    } finally {
      preservingFormatSelection = false;
    }
    draftHtml = editor.innerHTML;
    notifyTextLayoutChanged(element.id);
    if (!restoreSelectionBookmark(selection) && !restoreSelection(selectionRange)) rememberSelection();
    preserveSelectionAfterUpdate(selection, formatRevision);
    void persistDraft(false).then(() => {
      preserveSelectionAfterUpdate(selection, formatRevision);
    });
  }

  function restoreSelection(range: Range | null): boolean {
    if (!editor || !range || !editor.contains(range.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    try {
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
      return true;
    } catch {
      return false;
    }
  }

  function restoreSelectionBookmark(bookmark: TextSelectionBookmark | null): boolean {
    if (!editor || !bookmark) return false;
    const start = textPointAtOffset(editor, bookmark.start);
    const end = textPointAtOffset(editor, bookmark.end);
    if (!start || !end) return false;
    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
      return true;
    } catch {
      return false;
    }
  }

  function preserveSelectionAfterUpdate(
    bookmark: TextSelectionBookmark | null,
    revision: number,
  ): void {
    if (!bookmark) return;
    void tick().then(() => {
      if (
        !editor ||
        document.activeElement !== editor ||
        selectionRevision !== revision
      ) return;
      restoreSelectionBookmark(bookmark);
    });
  }

  async function finishEditing() {
    if (finishing || !editing) return;
    finishing = true;
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    try {
      await persistDraft(true);
      canvas.state.editText(null);
    } finally {
      finishing = false;
    }
  }

  async function persistDraft(measure: boolean) {
    const html = sanitizeTextHtml(editor?.innerHTML ?? draftHtml);
    const height = measure ? measuredBlockHeight() : element.height;
    try {
      await canvas.updateCanvasElement(workspaceId, {
        ...element,
        height,
        html,
      });
      draftHtml = html;
      notifyTextLayoutChanged(element.id);
    } catch {
      canvas.state.announce('Text changes could not be saved.');
    }
  }

  function measuredBlockHeight(): number {
    const block = editor?.closest<HTMLElement>('.canvas-text-block');
    const visualHeight = block?.getBoundingClientRect().height ?? 0;
    const contentHeight = (editor?.scrollHeight ?? 0) + 4;
    if (Number.isFinite(visualHeight) && visualHeight > 0) {
      const scale = Math.max(0.0001, canvasApplicationScale() * zoom);
      return Math.max(
        TEXT_BLOCK_MIN_HEIGHT,
        Math.ceil(Math.max(visualHeight / scale, contentHeight)),
      );
    }
    return Math.max(
      TEXT_BLOCK_MIN_HEIGHT,
      Math.ceil(Math.max(element.height, contentHeight)),
    );
  }

  function style(element: TextElement): string {
    return [
      `left:${element.x}px`,
      `top:${element.y}px`,
      `width:${resizedWidth ?? element.width}px`,
      `min-height:${resizedHeight ?? element.height}px`,
      `color:${element.color}`,
      `font-size:${element.fontSize}px`,
      `text-align:${element.textAlign}`,
    ].join(';');
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function fallbackTextRangeFrame(anchor: TextRangeAnchor): TextRangeFrame {
    return {
      height: Math.max(1, anchor.height),
      width: Math.max(1, anchor.width),
      x: anchor.x,
      y: anchor.y,
    };
  }

  function sameTextRange(left: TextRangeAnchor, right: TextRangeAnchor): boolean {
    return left.startOffset === right.startOffset &&
      left.endOffset === right.endOffset;
  }
</script>

<div
  class="canvas-text-block"
  class:canvas-text-block--editing={editing}
  class:canvas-text-block--bars-one={element.leftBars === 1}
  class:canvas-text-block--bars-two={element.leftBars === 2}
  class:canvas-text-block--moving={moving}
  class:canvas-text-block--arrow-source={textArrowHighlightFrames.length > 0}
  class:canvas-text-block--selected={selected}
  data-canvas-element-id={element.id}
  style={style(element)}
  role="button"
  tabindex="0"
  aria-label={`Text: ${textElementLabel(element)}`}
  title={editing
    ? 'Edit text · Esc or ⌘Enter to finish'
    : textArrowAnchor
      ? `Drag from or click an explanation target for “${textArrowAnchor.quote}”`
      : 'Drag to move · Double-click to edit'}
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
  {#each textArrowHighlightFrames as highlight (highlight.key)}
    <span
      class="canvas-text-arrow-highlight canvas-text-arrow-source"
      class:canvas-text-arrow-highlight--active={highlight.active}
      style={`--canvas-arrow-color:${highlight.color};left:${highlight.frame.x}px;top:${highlight.frame.y}px;width:${highlight.frame.width}px;height:${highlight.frame.height}px`}
      aria-hidden="true"
    ></span>
  {/each}
  <!-- The surface is a textbox only while editing; it is kept mounted so its
       layout cannot change when the editor mode toggles. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="canvas-text-surface"
    class:canvas-text-editor={editing}
    class:canvas-text-content={!editing}
    class:canvas-text-editor--empty={editing && !draftHtml}
    class:canvas-text-surface--empty={!draftHtml}
    contenteditable="false"
    tabindex={editing ? 0 : -1}
    role={editing ? 'textbox' : undefined}
    aria-label={editing ? 'Text editor' : undefined}
    aria-multiline={editing ? 'true' : undefined}
    data-placeholder={editing ? 'Type something…' : 'Untitled text'}
    bind:this={editor}
    bind:innerHTML={draftHtml}
    oninput={handleInput}
    onkeyup={rememberSelection}
    onmouseup={rememberSelection}
    onpaste={handlePaste}
    onblur={() => void finishEditing()}
  ></div>
  {#if selected && !editing && !moving}
    <button
      class="text-resize-handle"
      type="button"
      aria-label="Resize text width and height"
      title="Drag to resize width and height · Arrow keys resize"
      onpointerdown={startResize}
      onpointermove={continueResize}
      onpointerup={finishResize}
      onpointercancel={finishResize}
      onkeydown={resizeWithKeyboard}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 12 7-7M8 12l4-4M11 12l1-1" /></svg>
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

  .canvas-text-block--arrow-source {
    background: rgb(99 91 224 / 7%);
  }

  .canvas-text-arrow-highlight,
  .canvas-text-arrow-source {
    position: absolute;
    z-index: 0;
    box-sizing: border-box;
    min-width: 3px;
    min-height: 1px;
    border: 2px solid var(--canvas-arrow-color, #635be0);
    border-radius: 4px;
    background: color-mix(in srgb, var(--canvas-arrow-color, #635be0) 16%, transparent);
    box-shadow:
      0 2px 7px color-mix(in srgb, var(--canvas-arrow-color, #635be0) 18%, transparent),
      inset 0 1px rgb(255 255 255 / 55%);
    pointer-events: none;
  }

  .canvas-text-arrow-highlight--active {
    animation: canvas-text-arrow-source-pulse 1.8s ease-in-out infinite;
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

  .canvas-text-surface,
  .canvas-text-editor,
  .canvas-text-content {
    display: block;
    position: relative;
    z-index: 1;
    width: 100%;
    min-width: 0;
    min-height: 1.5em;
    margin: 0;
    padding: 0;
    border: 0;
    box-sizing: border-box;
    outline: none;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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

  .canvas-text-surface--empty::before {
    color: #9aa59f;
    content: attr(data-placeholder);
    pointer-events: none;
  }

  .canvas-text-content.canvas-text-surface--empty::before {
    font-style: italic;
  }

  .canvas-text-surface :global(p),
  .canvas-text-surface :global(div) {
    margin: 0;
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
    cursor: nwse-resize;
    place-items: center;
    touch-action: none;
  }

  .text-resize-handle:hover { background: #e7f1ed; }
  .text-resize-handle:focus-visible { outline: 2px solid rgb(55 117 102 / 36%); outline-offset: 2px; }
  .text-resize-handle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }

  @media (prefers-reduced-motion: reduce) {
    .canvas-text-block { transition: none; }
    .canvas-text-arrow-highlight--active { animation: none; }
  }

  @keyframes canvas-text-arrow-source-pulse {
    0%, 100% { opacity: 0.72; }
    50% { opacity: 1; }
  }
</style>
