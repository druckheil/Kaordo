# Postgres

Local Compose runs separate PostgreSQL 18.6 instances for Kaordo application data and Keycloak credentials. `001_users.sql` initializes the Kaordo database on a fresh volume. It stores the stable UUIDv7 account ID and Keycloak subject mapping, never credentials or OTP secrets.

The official PostgreSQL 18 image stores its data under `/var/lib/postgresql/18/docker`; the Compose volumes mount `/var/lib/postgresql` to retain it. The initialization SQL is not automatically reapplied to a nonempty volume.
