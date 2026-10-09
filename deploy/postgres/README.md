# Migrations

`001_users.sql` initializes a fresh application database. The numbered files after it are applied in order on every start: by `pnpm dev` locally, by `deploy/nixos/apply-migrations.sh` in production and twice by `pnpm test:product:db`. Every migration must therefore be idempotent (`IF NOT EXISTS`, guarded backfills). The local and test runners take their list from `scripts/product-migrations.mjs`, so add new files there too.

- Apply migrations as the `kaordo` role. Tables created by `postgres` are inaccessible to Kerno.
- Migrations are forward-only and must stay compatible with the previous Kerno during a rollback.
- Kerno verifies the tables and indexes it requires at startup (`postgres.VerifySchema`).
- After a schema change, regenerate the Jet tables in `services/kerno/internal/postgres/jetdb` from a migrated database. Never edit them by hand.
- `020_end_to_end_encryption.sql` discarded all plaintext content once, guarded by the `content_encryption_epoch` marker table. On later runs it only reasserts the schema.

Keycloak uses its own PostgreSQL instance; this schema never stores credentials.
