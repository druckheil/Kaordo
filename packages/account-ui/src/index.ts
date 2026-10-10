// Exposes shared account access, avatars and presentation-only session previews

export { default as AccountGate } from './AccountGate.svelte';
export { default as UserAvatar } from './UserAvatar.svelte';
export { createAccountSessionController, loadAccountSnapshot } from './session.js';
export type { AccountSnapshot } from './session.js';
export { clearAccountPreview, readAccountPreview } from './session-preview.js';
export type { AccountPreview } from './session-preview.js';
