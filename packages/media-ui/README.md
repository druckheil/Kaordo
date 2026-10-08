# Kaordo media UI

Shared geometry and display for processed media. `media-layout.ts` determines reserved aspect ratios/crops from metadata. `MediaGallery` pairs two images in one responsive frame, sizes carousels from adjacent attachment ratios, and lets `edgeBleed` extend larger carousels to the host card's inner edges using `--media-gallery-edge-gutter`; `MessageMediaGrid` is the compact attachment layout for chat. These surfaces deliberately have different interaction models.

`mountPhotoSwipe` owns image-lightbox loading and disposal and is shared by
media galleries and profile avatar/banner anchors; `VideoPlayer` lazy-loads Vidstack and shows a decoded video frame before playback without storing a separate poster. `MediaPreview` renders medium noninteractive notification attachments, capped at 176 pixels high, inside a parent post link. Photos load lazily; videos use a static black frame with a Play symbol. No media element/player is mounted and no video URL is fetched in this preview; the normal player loads when the post opens. Download URLs are supplied by an authorized API response; this package does not mint signatures or fetch account state.

`ImageCropDialog` wraps lazy Cropper.js 2.3 in the shared Rhea/Bits UI Dialog.
Cropper owns frame dragging, resizing, zoom and keyboard interaction; its
standard grid/crosshair/move-handle order keeps the drag surface accessible.
Native inset constraints keep the frame inside the image. Precise coordinates
preserve the aspect ratio, and the native export hook normalizes integer canvas
dimensions before drawing. `cropper-images.ts` owns these geometry/export
operations; the dialog owns loading, controls and cleanup. The caller supplies the aspect ratio and output
dimensions. Cropping returns a local image File and
does not upload it. Disposal destroys the cropper, disconnects its resize
observer and releases the source object URL. Fluo composes it for profile
avatars and banners.

Test with `pnpm test:ui-layout`, product fixtures and the live media journey. Geometry is applied before image decoding to avoid avoidable layout shifts. See [refactor evidence](../../docs/refactoring.md).
