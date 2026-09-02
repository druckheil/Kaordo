<script lang="ts">
  import { onDestroy, tick } from 'svelte';
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
  import { canvasApplicationScale } from '../../lib/features/canvas';
  import { openContextMenu } from '../../lib/ui/contextMenu';

  type Props = {
    canvas: CanvasService;
    arrowSource?: TextArrowSource | null;
    editing: boolean;
    element: TextElement;
    maxWidth?: number;
    moving?: boolean;
    onStartMove: (event: PointerEvent, element: TextElement) => void;
    selected: boolean;
    workspaceId: string;
  };

  type TextSelectionBookmark = {
    end: number;
    start: number;
  };

  let {
    canvas,
    arrowSource = null,
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
  let selectionRevision = 0;
  let preservingFormatSelection = false;
  let autosaveTimer: number | null = null;
  let lastPointerDown: { at: number; id: string } | null = null;
  let resize = $state<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
  } | null>(null);
  let resizedWidth = $state<number | null>(null);
  let textArrowAnchor = $derived(
    arrowSource?.elementId === element.id ? arrowSource.anchor : null,
  );

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
    draftHtml = editor?.innerHTML ?? '';
    if (!preservingFormatSelection) rememberSelection();
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
    const scale = Math.max(0.0001, canvasApplicationScale() * canvas.currentZoom());
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

  function textOffset(root: Node, target: Node, offset: number): number | null {
    let total = 0;
    let found = false;
    const visit = (node: Node): void => {
      if (found) return;
      if (node === target) {
        if (node.nodeType === 3) {
          const limit = node.textContent?.length ?? 0;
          total += Math.max(0, Math.min(offset, limit));
        } else {
          const limit = node.childNodes.length;
          const childOffset = Math.max(0, Math.min(offset, limit));
          for (let index = 0; index < childOffset; index += 1) {
            total += node.childNodes[index]?.textContent?.length ?? 0;
          }
        }
        found = true;
        return;
      }
      if (node.nodeType === 3) {
        total += node.textContent?.length ?? 0;
        return;
      }
      for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return found ? total : null;
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

  function textPointAtOffset(
    root: Node,
    offset: number,
  ): { node: Node; offset: number } | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let lastText: Node | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      lastText = node;
    }
    if (lastText) {
      return { node: lastText, offset: lastText.textContent?.length ?? 0 };
    }
    return { node: root, offset: 0 };
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
  class:canvas-text-block--arrow-source={textArrowAnchor !== null}
  class:canvas-text-block--selected={selected}
  data-canvas-element-id={element.id}
  style={style(element)}
  role="button"
  tabindex="0"
  aria-label={`Text: ${textElementLabel(element)}`}
  title={editing
    ? 'Edit text · Esc or ⌘Enter to finish'
    : textArrowAnchor
      ? `Drag an explanation arrow from “${textArrowAnchor.quote}”`
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
  {#if textArrowAnchor}
    <span
      class="canvas-text-arrow-source"
      style={`left:${textArrowAnchor.x}px;top:${textArrowAnchor.y}px;width:${textArrowAnchor.width}px;height:${textArrowAnchor.height}px`}
      aria-hidden="true"
    ></span>
  {/if}
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

  .canvas-text-block--arrow-source {
    background: rgb(99 91 224 / 7%);
  }

  .canvas-text-arrow-source {
    position: absolute;
    z-index: 0;
    box-sizing: border-box;
    min-width: 3px;
    min-height: 1.2em;
    border: 1px solid rgb(99 91 224 / 42%);
    border-radius: 4px;
    background: rgb(99 91 224 / 18%);
    box-shadow:
      0 2px 7px rgb(73 68 181 / 16%),
      inset 0 1px rgb(255 255 255 / 55%);
    pointer-events: none;
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

  .canvas-text-editor,
  .canvas-text-content {
    position: relative;
    z-index: 1;
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
    .canvas-text-arrow-source { animation: none; }
  }

  @keyframes canvas-text-arrow-source-pulse {
    0%, 100% { opacity: 0.72; }
    50% { opacity: 1; }
  }
</style>
