import { describe, expect, it } from 'vitest';
import { countFluoTextLines, FLUO_POST_PREVIEW_LINES, shouldExpandFluoText } from './fluoText';

describe('fluoText', () => {
  it('counts explicit line breaks even when each line has one character', () => {
    expect(countFluoTextLines(Array.from({ length: 11 }, () => 'x').join('\n'))).toBe(11);
    expect(shouldExpandFluoText(Array.from({ length: FLUO_POST_PREVIEW_LINES + 1 }, () => 'x').join('\n'))).toBe(true);
  });

  it('counts long wrapped text without requiring a DOM measurement', () => {
    expect(countFluoTextLines('x'.repeat(59))).toBe(2);
    expect(shouldExpandFluoText('x'.repeat(58 * FLUO_POST_PREVIEW_LINES))).toBe(false);
    expect(shouldExpandFluoText('x'.repeat(58 * FLUO_POST_PREVIEW_LINES + 1))).toBe(true);
  });
});
