// Shares an optional application header action without coupling the design system to account behavior
import type { Snippet } from 'svelte';
export const headerActionsContext = Symbol('header-actions');
export type HeaderActions = () => Snippet | undefined;
