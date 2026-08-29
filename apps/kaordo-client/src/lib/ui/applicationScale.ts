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
  // Appearance gateways apply the active value inline. Reading it directly
  // avoids forcing a style recalculation on every pointer/scroll sample.
  const inline = Number.parseFloat(root.style.getPropertyValue('--app-scale'));
  if (Number.isFinite(inline) && inline > 0) return inline;

  if (typeof globalThis.getComputedStyle !== 'function') return 1;
  const computed = Number.parseFloat(
    globalThis.getComputedStyle(root).getPropertyValue('--app-scale'),
  );
  return Number.isFinite(computed) && computed > 0 ? computed : 1;
}
