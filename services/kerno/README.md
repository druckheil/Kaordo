# Kerno

Modular Go API for accounts, Fluo, Ligo, Rondo, Lingvo, Memoro and Regado. chi routes and middleware validate OIDC identity and current database access; domain packages own models, store contracts, absence errors and input validation. `internal/postgres` implements these contracts with Jet/pgx transactions, organized into reads, writes, interactions, membership, receipts, media claims and administration. Credentials and OTP secrets stay in Keycloak.

`cmd/kerno` separates process lifecycle, configuration and dependency wiring. `postgres.VerifySchema` checks storage prerequisites before startup. One `httpapi.NewRouter` accepts configured feature modules; operation files separate HTTP reads, writes, media and activity. HTTP handlers consume domain store contracts and outbound media/voice/system ports; they do not import the PostgreSQL adapter. `nodoclient`, `regado` and `rondovoice` implement outbound requests. The server drains active HTTP before closing event workers and database resources. PostgreSQL LISTEN/SSE provides membership-scoped message change hints, not message delivery without authorization.

Nodo metadata and ownership are checked before an attachment is claimed. Fluo/Ligo handlers share attachment ID and uniqueness checks; encrypted descriptions remain in content envelopes. Claims are reusable while referenced, then retired transactionally before purge, including profile and Memoro references. mediaauth supplies short-lived signed download URLs. Kerno checks channel membership before `internal/rondovoice` issues LiveKit tokens. Regado checks current admin/disabled status and audits fixed operations; content-access cases and administrator recovery overrides do not exist.

`encryption` owns signed account/device/recovery and content-envelope contracts.
`vault` owns revision-checked private records; `memoro` owns opaque daily documents
and attachment claims. HTTP rejects new plaintext product writes; PostgreSQL checks
the intended audience against current access inside write transactions. Lingvo
historical export retires old dictionaries only after encrypted replacement records
exist. No account private key or recovery secret is stored by Kerno. See the
[migration and trust boundaries](../../docs/encryption.md).

`admin.SystemOperations` coordinates validated system commands through narrow audit, host-command and file-maintenance ports. HTTP owns decoding, authorization and response mapping; the service preserves preflight → requested audit → host action → applicable Nodo maintenance → outcome audit ordering. The agent retains its independent privileged-operation validation. See the [design-pattern review](../../docs/audits/architecture-patterns-2026-10-08.md).

Fluo records social notifications in the same pgx transaction as posts, reactions and follows. Its notification store exposes recipient-scoped keyset pages, access-filtered unread counts, destination media and persistent read timestamps. All kinds share an indexed one-hour cooldown per recipient/actor/kind/destination post; later actual repeats append a fresh event while preserving earlier read history. New replies/quotes use distinct post IDs and notify separately. Originating relation/post writes serialize repeats before the cooldown query; unchanged reaction/follow/visibility requests never emit again. The single-item read endpoint only marks read and preserves the first timestamp; it cannot make an item unread. List/count snapshots are consistent; bounded bulk reads preserve newer notifications. Existing media signing uses minute-stable expiry times to avoid reloading previews on every poll. Self-actions and private saves never identify activity to another account; private replies/quotes notify when actually published. Foreign keys remove entries for deleted posts/accounts. Apply migration 014 before starting this version of Kerno; startup checks the cooldown index as well as the table.

Use [local configuration](../../deploy/local/README.md) or [NixOS](../../deploy/nixos/README.md). All numbered SQL migrations, including Regado migration 011, must be applied as the application role before startup. Browser origins, issuer/audience, database connection, Nodo URL/signing settings and LiveKit settings are required for the corresponding features. Never commit runtime environment files.

```sh
go test -race ./services/kerno/...
go build ./services/kerno/...
pnpm test:product:db
```

The database test uses a disposable database and covers Fluo, Ligo, Rondo and Regado. See [refactor evidence](../../docs/refactoring.md).
