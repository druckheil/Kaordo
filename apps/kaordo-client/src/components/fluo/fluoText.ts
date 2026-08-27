/** Number of text lines shown in a feed card before opening the full post. */
export const FLUO_POST_PREVIEW_LINES = 10;

/**
 * The feed uses the same logical width estimate for virtualization. Counting
 * wrapped characters here keeps the expand affordance deterministic before a
 * row is measured, while explicit line breaks always count as their own line.
 */
export function countFluoTextLines(text: string, charactersPerLine = 58): number {
  if (!text) return 0;
  const width = Math.max(1, Math.floor(charactersPerLine));
  return text.split(/\r?\n/).reduce((total, line) => {
    const characters = Array.from(line).length;
    return total + Math.max(1, Math.ceil(characters / width));
  }, 0);
}

export function shouldExpandFluoText(text: string): boolean {
  return countFluoTextLines(text) > FLUO_POST_PREVIEW_LINES;
}
