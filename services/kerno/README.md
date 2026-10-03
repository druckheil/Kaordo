# Kerno

Modular Go API for accounts, Fluo, Ligo, Rondo and Regado. chi routes and middleware validate OIDC identity and current database access; domain packages validate product inputs. `internal/postgres` uses Jet with pgx transactions, organized into reads, writes, interactions, membership, receipts, media claims and administration. Credentials and OTP secrets stay in Keycloak.

`cmd/kerno/main.go` loads configuration, wires dependencies, starts the server and drains active requests before closing database resources. HTTP handlers coordinate services; domain and persistence packages retain their own ownership. PostgreSQL LISTEN/SSE provides membership-scoped message change hints, not message delivery without authorization.

Nodo metadata and ownership are checked before an attachment is claimed. Claims are reusable while referenced, then retired transactionally before purge. mediaauth supplies short-lived signed download URLs. `internal/rondovoice` checks membership and issues LiveKit tokens. Regado checks current admin/disabled status, audits actions and provides time-limited content access cases with Ligo notifications.

Use [local configuration](../../deploy/local/README.md) or [NixOS](../../deploy/nixos/README.md). All numbered SQL migrations, including Regado migration 011, must be applied as the application role before startup. Browser origins, issuer/audience, database connection, Nodo URL/signing settings and LiveKit settings are required for the corresponding features. Never commit runtime environment files.

```sh
go test -race ./services/kerno/...
go build ./services/kerno/...
pnpm test:product:db
```

The database test uses a disposable database and covers Fluo, Ligo, Rondo and Regado. See [refactor evidence](../../docs/refactoring.md).
