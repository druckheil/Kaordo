import type { SoftUiRuntime } from '@kaordo/softui';

declare global {
  var SoftUI: SoftUiRuntime | undefined;
}

let runtimePromise: Promise<SoftUiRuntime | null> | undefined;

/**
 * Load the vendored SoftUI assets only for a screen that opts into them.
 *
 * The current Kaordo shell deliberately does not import SoftUI globally: the
 * library contains a complete reset and body theme, so loading it globally
 * would change existing sections before they are migrated. This keeps the
 * upstream rendering 1:1 inside future SoftUI surfaces while preserving the
 * current application until each surface is migrated deliberately.
 */
export function loadSoftUi(): Promise<SoftUiRuntime | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);

  runtimePromise ??= Promise.all([
    import('@kaordo/softui/style.css'),
    import('@kaordo/softui/runtime.js'),
  ]).then(() => globalThis.SoftUI ?? null);

  return runtimePromise;
}

export function resetSoftUiLoader(): void {
  runtimePromise = undefined;
}
