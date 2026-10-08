# Kaordo media client

Shared Uppy/Tus upload workflow and Pica image resize. `image-processing.ts` owns image decoding/resizing; `tus-storage.ts` scopes resumable-upload fingerprints and validates stored upload URLs; the entry point orchestrates file selection, progress, processing metadata and cleanup.

An optional AbortSignal follows preparation, Uppy's native cancellation and Nodo
processing requests/delays. The upload owner disposes the workflow when its app
closes; listeners and processing timers are removed on completion or cancellation.

Do not publish a post/message before Nodo confirms processing. Returned width/height, MIME and processed size become the authoritative attachment metadata; file descriptions belong to the owning product contract. Upload authentication uses the shared in-memory session, never tokens in local storage or URLs. `pnpm test:media` checks resumable storage scoping; live tests check real image/video processing. See [refactor evidence](../../docs/refactoring.md).
