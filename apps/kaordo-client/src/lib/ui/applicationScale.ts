/**
 * Returns the CSS scale applied to the application root.
 *
 * Application Size uses CSS `zoom` so browser and Tauri share one rendering
 * path. Pointer events report visual pixels while fixed-position descendants
 * of the zoomed root use its logical CSS coordinate space; consumers that
 * position overlays must convert through this value.
 */
export function applicationScale(): number {
  if (typeof globalThis.document === 'undefined') return 1;

  const root = globalThis.document.documentElement;
  const inline = root.style.getPropertyValue('--app-scale');
  const computed = typeof globalThis.getComputedStyle === 'function'
    ? globalThis.getComputedStyle(root).getPropertyValue('--app-scale')
    : '';
  const value = Number.parseFloat(inline || computed);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
