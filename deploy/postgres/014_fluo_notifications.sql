-- Stores recipient-owned Fluo activity, read state and hourly event lookup indexes
BEGIN;

CREATE TABLE IF NOT EXISTS fluo_notifications (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('like', 'dislike', 'reply', 'quote', 'follow')),
    post_id uuid REFERENCES fluo_posts(id) ON DELETE CASCADE,
    subject_post_id uuid REFERENCES fluo_posts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    read_at timestamptz,
    CONSTRAINT fluo_notifications_no_self CHECK (recipient_id <> actor_id),
    CONSTRAINT fluo_notifications_post_kind CHECK (
        (kind = 'follow' AND post_id IS NULL AND subject_post_id IS NULL) OR
        (kind <> 'follow' AND post_id IS NOT NULL AND subject_post_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS fluo_notifications_timeline_idx
    ON fluo_notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS fluo_notifications_unread_idx
    ON fluo_notifications (recipient_id, created_at DESC, id DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS fluo_notifications_event_lookup_idx
    ON fluo_notifications (recipient_id, actor_id, kind, post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fluo_notifications_actor_idx ON fluo_notifications (actor_id);
CREATE INDEX IF NOT EXISTS fluo_notifications_post_idx ON fluo_notifications (post_id);
CREATE INDEX IF NOT EXISTS fluo_notifications_subject_idx ON fluo_notifications (subject_post_id);

COMMIT;
