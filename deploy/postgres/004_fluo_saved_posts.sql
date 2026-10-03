BEGIN;

CREATE TABLE IF NOT EXISTS fluo_saved_posts (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES fluo_posts(id) ON DELETE CASCADE,
    saved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS fluo_saved_posts_timeline_idx
    ON fluo_saved_posts (user_id, saved_at DESC, post_id DESC);

COMMIT;
