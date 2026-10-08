# Kaordo media client

Shared Uppy/Tus upload workflow and Pica image resize. `image-processing.ts` owns image decoding/resizing; `tus-storage.ts` scopes resumable-upload fingerprints and validates stored upload URLs; the entry point orchestrates file selection, progress, processing metadata and cleanup.

`prepareImage`, `isSupportedImageType` and `MAX_IMAGE_SIZE` expose the same
bounded image preparation to profile cropping before the existing upload flow.
Presentation and crop interaction belong to `media-ui`; the app owns the draft
and decides when to upload.

An optional AbortSignal follows preparation, Uppy's native cancellation and Nodo
processing requests/delays. The upload owner disposes the workflow when its app
closes; listeners and processing timers are removed on completion or cancellation.

Uploads prepare/rescale images and read bounded image/video dimensions on the
device, then encrypt bytes with `crypto` before Uppy/Tus sends them. Nodo confirms
storage of an opaque generic file. Original filename, MIME, dimensions, size and
content key are embedded in the owning encrypted product document. Memoro supplies
its own encrypted bytes and public profile images pass `encrypt: false`, keeping
Nodo's image processing.

Do not publish before Nodo confirms processing/storage. Upload authentication
uses the shared in-memory session, never tokens in local storage or URLs.
See [encryption](../../docs/encryption.md) and [refactor evidence](../../docs/refactoring.md).
