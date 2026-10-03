# Media authorization

Independent Go library shared by Kerno and Nodo for short-lived signed media URLs. `mediaauth.go` validates the base URL, file ID, expiry and HMAC signature; Kerno issues links only after product access checks, and Nodo verifies them before serving bytes.

Signing keys remain in ignored/private runtime files. This authorizes a download for a bounded time; it does not encrypt content and does not immediately invalidate already issued links when access changes.

Run `go test -race ./services/mediaauth/...` from the repository root. See [storage boundaries](../../deploy/storage/README.md) and [refactor evidence](../../docs/refactoring.md).
