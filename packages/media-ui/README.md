# Kaordo media UI

Shared geometry and display for processed media. `media-layout.ts` determines reserved aspect ratios/crops from metadata. `MediaGallery` pairs two images in one responsive frame, sizes carousels from adjacent attachment ratios, and lets `edgeBleed` extend larger carousels to the host card's inner edges using `--media-gallery-edge-gutter`; `MessageMediaGrid` is the compact attachment layout for chat. These surfaces deliberately have different interaction models.

`photo-swipe.ts` owns image-lightbox loading; `VideoPlayer` lazy-loads Vidstack and shows a decoded video frame before playback without storing a separate poster. Download URLs are supplied by an authorized API response; this package does not mint signatures or fetch account state.

Test with `pnpm test:ui-layout`, product fixtures and the live media journey. Geometry is applied before image decoding to avoid avoidable layout shifts. See [refactor evidence](../../docs/refactoring.md).
