# Nodo

Independent Go upload and byte-storage service. tusd v2 implements tus protocol 1.0; upload, metadata and quota handlers verify the owner through Kerno. Defaults allow 200 source uploads and 2 GiB of source bytes per account. JPEG/PNG/WebP images have a 20 MiB source limit; video and generic files have a 100 MiB limit. Valid images are identified by decoded bytes even if their submitted image MIME type is mislabeled, then re-encoded to JPEG/PNG. FFprobe/FFmpeg validate and produce H.264/AAC MP4 up to 120 seconds. Generic files are staged unchanged and served as downloads.

`cmd/nodo` wires configuration and drains HTTP before closing the upload server. `internal/upload/handler.go` assembles routing and owns the server lifecycle; upload/media handlers, quota/identity, processing queue, image/video/file processors and cleanup/GC are separate files. `Server.Close` cancels and waits for background processing/GC; FFmpeg follows the processing context. Cancelled work remains resumable rather than being marked a permanent processing failure.

Kerno links processed metadata (dimensions, MIME and size) and signs media access URLs; these reserve image/video geometry before download. Files are mode 0600. Active references protect bytes from purge, including references shared across Fluo, Ligo and Rondo. Final-reference deletion requests immediate purge; a six-hour scan removes unreferenced uploads older than 24 hours. Failed reference checks keep bytes for retry.

`maintenance.go` exposes authenticated internal status and background check/repair
operations for Regado. Artifact inventories report expired unreferenced files,
unknown files, and missing expected display files. Repair reuses garbage
collection, rechecking Kerno references and canonical upload age immediately
before removal, then rescans. Fresh uploads and files with unavailable reference
evidence remain stored. These operations do not create replicas: Btrfs manages
them below Nodo. Reports are timestamped in memory and reset on service restart.

`pnpm dev` runs Nodo on `127.0.0.1:8082`. Install `ffmpeg`/`ffprobe` for videos. Local media is ignored under `deploy/local/media`; production uses mirrored Data1. Source and processed files both consume disk. Product content encryption is absent. See [storage and backup boundaries](../../deploy/storage/README.md).

```sh
go test -race ./services/nodo/... ./services/mediaauth/...
go build ./services/nodo/...
```
