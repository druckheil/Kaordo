BEGIN;

CREATE TABLE IF NOT EXISTS fluo_posts (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content jsonb NOT NULL,
    plain_text text NOT NULL,
    visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
    parent_id uuid REFERENCES fluo_posts(id) ON DELETE CASCADE,
    quote_id uuid REFERENCES fluo_posts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fluo_post_kind CHECK (parent_id IS NULL OR quote_id IS NULL),
    CONSTRAINT fluo_post_text_limit CHECK (char_length(plain_text) <= 5000)
);

CREATE INDEX IF NOT EXISTS fluo_posts_timeline_idx
    ON fluo_posts (created_at DESC, id DESC) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS fluo_posts_author_idx
    ON fluo_posts (author_id, created_at DESC, id DESC) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS fluo_posts_comments_idx
    ON fluo_posts (parent_id, created_at DESC, id DESC) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fluo_reactions (
    post_id uuid NOT NULL REFERENCES fluo_posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value text NOT NULL CHECK (value IN ('good', 'bad')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS fluo_follows (
    follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CONSTRAINT fluo_no_self_follow CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS fluo_follows_followed_idx ON fluo_follows (followed_id);

CREATE TABLE IF NOT EXISTS fluo_post_media (
    post_id uuid NOT NULL REFERENCES fluo_posts(id) ON DELETE CASCADE,
    upload_id uuid NOT NULL,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
    kind text NOT NULL CHECK (kind IN ('image', 'video')),
    mime_type text NOT NULL,
    width integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
    PRIMARY KEY (post_id, upload_id),
    UNIQUE (post_id, position)
);
CREATE INDEX IF NOT EXISTS fluo_post_media_upload_idx ON fluo_post_media (upload_id);
ALTER TABLE fluo_post_media ADD COLUMN IF NOT EXISTS alt_text text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS fluo_upload_claims (
    upload_id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claimed_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve claims for uploads linked before this table was added.
INSERT INTO fluo_upload_claims (upload_id, owner_id)
SELECT m.upload_id, p.author_id FROM fluo_post_media m
JOIN fluo_posts p ON p.id = m.post_id
ON CONFLICT (upload_id) DO NOTHING;

-- Existing local databases may have applied an earlier version of this migration.
ALTER TABLE fluo_posts DROP CONSTRAINT IF EXISTS fluo_posts_author_id_fkey;
ALTER TABLE fluo_posts ADD CONSTRAINT fluo_posts_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
