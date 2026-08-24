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

export function openContextMenu(
  event: MouseEvent,
  label: string,
  items: ContextMenuItem[],
): void {
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
