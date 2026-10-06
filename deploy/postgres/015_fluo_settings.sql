-- Persists Fluo preferences and extends activity notifications to unfollows
BEGIN;

CREATE TABLE IF NOT EXISTS fluo_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notify_likes text NOT NULL DEFAULT 'all' CHECK (notify_likes IN ('all', 'off', 'following')),
    notify_dislikes text NOT NULL DEFAULT 'all' CHECK (notify_dislikes IN ('all', 'off', 'following')),
    notify_replies text NOT NULL DEFAULT 'all' CHECK (notify_replies IN ('all', 'off', 'following')),
    notify_follows text NOT NULL DEFAULT 'all' CHECK (notify_follows IN ('all', 'off', 'following')),
    notify_unfollows text NOT NULL DEFAULT 'off' CHECK (notify_unfollows IN ('all', 'off', 'following')),
    notify_quotes text NOT NULL DEFAULT 'all' CHECK (notify_quotes IN ('all', 'off', 'following')),
    account_visibility text NOT NULL DEFAULT 'public' CHECK (account_visibility IN ('public', 'private')),
    show_likes boolean NOT NULL DEFAULT true
);

ALTER TABLE fluo_notifications DROP CONSTRAINT IF EXISTS fluo_notifications_kind_check;
ALTER TABLE fluo_notifications ADD CONSTRAINT fluo_notifications_kind_check
    CHECK (kind IN ('like', 'dislike', 'reply', 'quote', 'follow', 'unfollow'));
ALTER TABLE fluo_notifications DROP CONSTRAINT IF EXISTS fluo_notifications_post_kind;
ALTER TABLE fluo_notifications ADD CONSTRAINT fluo_notifications_post_kind CHECK (
    (kind IN ('follow', 'unfollow') AND post_id IS NULL AND subject_post_id IS NULL) OR
    (kind NOT IN ('follow', 'unfollow') AND post_id IS NOT NULL AND subject_post_id IS NOT NULL)
);

COMMIT;
