-- Stores Fluo profiles, cropped images and privacy-aware availability
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users (lower(username));
DROP INDEX IF EXISTS users_username_idx;

CREATE TABLE IF NOT EXISTS fluo_profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nickname text NOT NULL DEFAULT '' CHECK (char_length(nickname) <= 80),
    bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
    birth_date date,
    location text NOT NULL DEFAULT '' CHECK (char_length(location) <= 100),
    website text NOT NULL DEFAULT '' CHECK (char_length(website) <= 300),
    pronouns text NOT NULL DEFAULT '' CHECK (char_length(pronouns) <= 40),
    verified boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'busy', 'invisible')),
    last_active_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Verification belongs to the existing account ID, never to an editable nickname.
INSERT INTO fluo_profiles (user_id, verified)
SELECT id, true FROM users WHERE lower(username) = 'druckheil'
ON CONFLICT (user_id) DO UPDATE SET verified = true;

CREATE TABLE IF NOT EXISTS fluo_profile_images (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot text NOT NULL CHECK (slot IN ('avatar', 'banner')),
    upload_id uuid NOT NULL REFERENCES nodo_upload_claims(upload_id),
    mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    width integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
    PRIMARY KEY (user_id, slot),
    CONSTRAINT fluo_profile_image_ratio CHECK (
        (slot = 'avatar' AND width = height) OR (slot = 'banner' AND width = height * 3)
    )
);
CREATE INDEX IF NOT EXISTS fluo_profile_images_upload_idx ON fluo_profile_images (upload_id);

ALTER TABLE fluo_settings ADD COLUMN IF NOT EXISTS presence_visibility text NOT NULL DEFAULT 'all'
    CHECK (presence_visibility IN ('all', 'friends', 'off'));

CREATE INDEX IF NOT EXISTS fluo_followers_page_idx ON fluo_follows (followed_id, created_at DESC, follower_id DESC);
CREATE INDEX IF NOT EXISTS fluo_following_page_idx ON fluo_follows (follower_id, created_at DESC, followed_id DESC);

COMMIT;
