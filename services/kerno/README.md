# Kerno

Modular Go API for accounts, Fluo, Ligo, Rondo and Regado. chi routes and middleware validate OIDC identity and current database access; domain packages validate product inputs. `internal/postgres` uses Jet with pgx transactions, organized into reads, writes, interactions, membership, receipts, media claims and administration. Credentials and OTP secrets stay in Keycloak.

`cmd/kerno/main.go` loads configuration, wires dependencies, starts the server and drains active requests before closing database resources. HTTP handlers coordinate services; domain and persistence packages retain their own ownership. PostgreSQL LISTEN/SSE provides membership-scoped message change hints, not message delivery without authorization.

Nodo metadata and ownership are checked before an attachment is claimed. Claims are reusable while referenced, then retired transactionally before purge. mediaauth supplies short-lived signed download URLs. `internal/rondovoice` checks membership and issues LiveKit tokens. Regado checks current admin/disabled status, audits actions and provides time-limited content access cases with Ligo notifications.

Fluo records social notifications in the same pgx transaction as posts, reactions and follows. Its notification store exposes recipient-scoped keyset pages, access-filtered unread counts, destination media and persistent read timestamps. All kinds share an indexed one-hour cooldown per recipient/actor/kind/destination post; later actual repeats append a fresh event while preserving earlier read history. New replies/quotes use distinct post IDs and notify separately. Originating relation/post writes serialize repeats before the cooldown query; unchanged reaction/follow/visibility requests never emit again. The single-item read endpoint only marks read and preserves the first timestamp; it cannot make an item unread. List/count snapshots are consistent; bounded bulk reads preserve newer notifications. Existing media signing uses minute-stable expiry times to avoid reloading previews on every poll. Self-actions and private saves never identify activity to another account; private replies/quotes notify when actually published. Foreign keys remove entries for deleted posts/accounts. Apply migration 014 before starting this version of Kerno; startup checks the cooldown index as well as the table.

Use [local configuration](../../deploy/local/README.md) or [NixOS](../../deploy/nixos/README.md). All numbered SQL migrations, including Regado migration 011, must be applied as the application role before startup. Browser origins, issuer/audience, database connection, Nodo URL/signing settings and LiveKit settings are required for the corresponding features. Never commit runtime environment files.

```sh
go test -race ./services/kerno/...
go build ./services/kerno/...
pnpm test:product:db
```

The database test uses a disposable database and covers Fluo, Ligo, Rondo and Regado. See [refactor evidence](../../docs/refactoring.md).
