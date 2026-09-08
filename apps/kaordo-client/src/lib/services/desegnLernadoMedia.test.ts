import { describe, expect, it } from 'vitest';
import { isDesegnImageFile } from './desegnLernadoMedia';

describe('DesegnLernado media intake', () => {
  it('accepts desktop files whose image MIME type is missing', () => {
    expect(isDesegnImageFile(new File(['drawing'], 'study.PNG'))).toBe(true);
    expect(isDesegnImageFile(new File(['drawing'], 'study.webp'))).toBe(true);
  });

  it('rejects non-images and vector documents', () => {
    expect(isDesegnImageFile(new File(['notes'], 'notes.txt', { type: 'text/plain' }))).toBe(false);
    expect(isDesegnImageFile(new File(['<svg/>'], 'drawing.svg', { type: 'image/svg+xml' }))).toBe(false);
  });
});
