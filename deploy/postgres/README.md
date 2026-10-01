# Postgres

Local Compose runs separate PostgreSQL 18.6 instances for Kaordo application data and Keycloak credentials. `001_users.sql` initializes the Kaordo database on a fresh volume. It stores the stable UUIDv7 account ID and Keycloak subject mapping, never credentials or OTP secrets.

The official PostgreSQL 18 image stores its data under `/var/lib/postgresql/18/docker`; the Compose volumes mount `/var/lib/postgresql` to retain it. The initialization SQL is not automatically reapplied to a nonempty volume.

The local launcher applies the numbered product migrations on each start. Migration 005 retires shared Nodo media claims after their final Fluo or Ligo reference is removed, preventing a concurrent post or message from linking a file that Nodo is about to purge. A retired upload ID cannot be reused; upload the file again after deleting its last reference.

Migration 006 installs PostgreSQL's `pg_trgm` extension and indexes case-insensitive substring search over post text, usernames and display names. This is an existing PostgreSQL extension; Kerno does not implement its own search index.

Migration 007 adds Ligo conversations, memberships, messages, and attachment references. Migration 008 adds unique personal Saved messages conversations. Migration 009 adds edits, deletion tombstones, three emoji reactions, delivery cursors, and the eight-attachment limit. The disposable database integration script reapplies migrations to check repeatability and shared attachment claims.
