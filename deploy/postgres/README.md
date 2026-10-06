# Postgres

Local Compose runs separate PostgreSQL 18.6 instances for Kaordo application data and Keycloak credentials. `001_users.sql` initializes the Kaordo database on a fresh volume. It stores the stable UUIDv7 account ID and Keycloak subject mapping, never credentials or OTP secrets.

The official PostgreSQL 18 image stores its data under `/var/lib/postgresql/18/docker`; the Compose volumes mount `/var/lib/postgresql` to retain it. The initialization SQL is not automatically reapplied to a nonempty volume.

The local launcher applies the numbered product migrations on each start. Migration 005 retires shared Nodo media claims after their final Fluo or Ligo reference is removed, preventing a concurrent post or message from linking a file that Nodo is about to purge. A retired upload ID cannot be reused; upload the file again after deleting its last reference.

Migration 006 installs PostgreSQL's `pg_trgm` extension and indexes case-insensitive substring search over post text, usernames and display names. This is an existing PostgreSQL extension; Kerno does not implement its own search index.

Migration 007 adds Ligo conversations, memberships, messages, and attachment references. Migration 008 adds unique personal Saved messages conversations. Migration 009 adds edits, deletion tombstones, three emoji reactions, delivery cursors, and the eight-attachment limit. The disposable database integration script reapplies migrations to check repeatability and shared attachment claims.

Migration 010 adds Rondo servers, memberships and channels. A channel refers to a Ligo conversation of kind `channel`; the Rondo transaction mirrors server membership into Ligo membership so message access uses the same checks and media references. Ligo's direct/group list excludes channel conversations.

Migration 011 adds current administrator roles, audit records, content access cases and immutable system notifications. Kerno checks these tables at startup. PostgreSQL queries are built with Jet and executed through pgx so transaction, cancellation and pooling remain explicit. Generated tables/models live under `services/kerno/internal/postgres/jetdb`; regenerate them against the migrated schema when changing tables. Never manually edit generated files or place a database URL in documentation/commits.

Migration 012 records when a quoted Fluo post is deleted and indexes live quote references for efficient cleanup. The referencing post keeps a tombstone while `quote_id` is cleared by its foreign key, so the UI can distinguish a deleted quote from a private or otherwise unavailable one.

Migration 013 adds the reverse lookup index used to count saves for each Fluo post without scanning the private saved-post lists.

Feature persistence files are split into reads, writes, interactions, membership, receipts and admin operations. Shared media-claim locking/retirement remains transactional across Fluo/Ligo/Rondo. Case-insensitive search lowers both the indexed column and search pattern; LIKE wildcard characters in user text are escaped literally. The disposable integration suite covers Fluo, Ligo, Rondo and Regado and replays every migration. See [refactor evidence](../../docs/refactoring.md).
