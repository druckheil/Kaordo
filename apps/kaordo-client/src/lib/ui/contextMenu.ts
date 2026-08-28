import { writable } from 'svelte/store';

export type ContextMenuIcon =
  | 'arrow'
  | 'delete'
  | 'edit'
  | 'focus'
  | 'open'
  | 'rectangle'
  | 'select'
  | 'text';

export type ContextMenuItem = {
  action: () => void | Promise<void>;
  confirmation?: string;
  danger?: boolean;
  hint?: string;
  icon: ContextMenuIcon;
  id: string;
  label: string;
};

export type ContextMenuSnapshot = {
  items: ContextMenuItem[];
  label: string;
  token: number;
  x: number;
  y: number;
};

export const contextMenu = writable<ContextMenuSnapshot | null>(null);
let nextContextMenuToken = 1;

/**
 * Keep the platform menu available for text editing and text selection.
 * Section context menus are useful for object actions, but must not swallow
 * the browser/WebView Copy, Look Up, and spelling actions users expect when
 * working with text.
 */
export function shouldUseNativeContextMenu(event: MouseEvent): boolean {
  const target = event.target;
  if (isEditableTarget(target)) return true;

  const selection = typeof window === 'undefined' ? null : window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;
  if (typeof Node === 'undefined' || !(target instanceof Node)) return false;

  return [selection.anchorNode, selection.focusNode].some((node) =>
    node !== null && (node === target || target.contains(node)),
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null;
}

export function openContextMenu(
  event: MouseEvent,
  label: string,
  items: ContextMenuItem[],
): void {
  if (shouldUseNativeContextMenu(event)) {
    closeContextMenu();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  contextMenu.set({
    items,
    label,
    token: nextContextMenuToken++,
    x: event.clientX,
    y: event.clientY,
  });
}

export function closeContextMenu(): void {
  contextMenu.set(null);
}
