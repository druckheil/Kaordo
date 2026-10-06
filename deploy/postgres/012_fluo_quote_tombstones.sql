BEGIN;

ALTER TABLE fluo_posts
    ADD COLUMN IF NOT EXISTS quote_deleted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS fluo_posts_quote_idx
    ON fluo_posts (quote_id) WHERE quote_id IS NOT NULL;

COMMIT;
