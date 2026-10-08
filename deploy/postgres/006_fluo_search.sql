BEGIN;

-- Index account search; post text is device-encrypted and searched on the device.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS users_username_trgm_idx
    ON users USING gin (lower(username) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_display_name_trgm_idx
    ON users USING gin (lower(display_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS fluo_posts_author_all_idx ON fluo_posts (author_id);

COMMIT;
