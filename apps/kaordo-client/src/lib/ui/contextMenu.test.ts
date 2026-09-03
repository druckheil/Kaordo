import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeContextMenu,
  contextMenu,
  openContextMenu,
  type ContextMenuItem,
} from './contextMenu';

const item: ContextMenuItem = {
  action: () => undefined,
  icon: 'select',
  id: 'select',
  label: 'Select',
};

describe('application context menu', () => {
  afterEach(() => closeContextMenu());

  it('suppresses modifier clicks used by canvas gestures', () => {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
      ctrlKey: true,
    });

    openContextMenu(event, 'Arrow', [item]);

    expect(event.defaultPrevented).toBe(true);
    expect(get(contextMenu)).toBeNull();
  });
});
