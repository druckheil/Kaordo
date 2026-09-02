import { describe, expect, it } from 'vitest';
import { clipboardMediaFiles } from './clipboardMedia';

describe('clipboard media extraction', () => {
  it('reads file clipboard items and gives nameless media a usable extension', () => {
    const image = new File(['image'], '', { type: 'image/png' });
    const clipboard = {
      files: [] as unknown as FileList,
      items: [{
        getAsFile: () => image,
        kind: 'file',
      }],
    } as unknown as DataTransfer;

    const files = clipboardMediaFiles(clipboard);

    expect(files).toHaveLength(1);
    expect(files[0]?.type).toBe('image/png');
    expect(files[0]?.name).toMatch(/^pasted-media-\d+-1\.png$/);
  });

  it('falls back to the file list and ignores unsupported clipboard files', () => {
    const image = new File(['image'], 'photo.webp', { type: 'image/webp' });
    const document = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const clipboard = {
      files: [image, document] as unknown as FileList,
      items: [],
    } as unknown as DataTransfer;

    expect(clipboardMediaFiles(clipboard)).toEqual([image]);
  });
});
