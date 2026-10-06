BEGIN;

CREATE INDEX IF NOT EXISTS fluo_saved_posts_post_idx
    ON fluo_saved_posts (post_id);

COMMIT;
