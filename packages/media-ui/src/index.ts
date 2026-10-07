// Exports media components and shared layout utilities
export { default as MediaGallery } from './MediaGallery.svelte';
export { default as MessageMediaGrid } from './MessageMediaGrid.svelte';
export { default as MediaPreview } from './MediaPreview.svelte';

export {
  mediaFrameHeightPx,
  mediaFrameRatio,
  maxMediaHeightRem,
  maxMediaRatio,
  mediaGapPx,
  minMediaRatio
} from './media-layout.js';
export type { MediaAttachment } from './media-layout.js';
