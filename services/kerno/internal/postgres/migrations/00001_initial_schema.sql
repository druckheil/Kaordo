-- Creates the Kaordo application schema: accounts, keys, product metadata and opaque ciphertext
-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Accounts and administration

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    keycloak_sub text NOT NULL UNIQUE CHECK (length(keycloak_sub) > 0),
    username text NOT NULL CHECK (length(username) > 0),
    display_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    disabled_reason text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX users_username_unique_idx ON users (lower(username));
CREATE INDEX users_username_trgm_idx ON users USING gin (lower(username) gin_trgm_ops);
CREATE INDEX users_display_name_trgm_idx ON users USING gin (lower(display_name) gin_trgm_ops);

CREATE TABLE user_roles (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role = 'admin'),
    granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, role)
);

CREATE TABLE admin_audit (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    actor_id uuid NOT NULL REFERENCES users (id),
    target_user_id uuid REFERENCES users (id),
    action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
    reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
    detail jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX admin_audit_recent_idx ON admin_audit (created_at DESC, id DESC);

-- Uploads referenced by product records; retired once the last reference is removed

CREATE TABLE nodo_upload_claims (
    upload_id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    retired_at timestamptz
);

-- Device-held keys: public identities and sealed bundles only

CREATE TABLE crypto_accounts (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    encryption_public_key text NOT NULL CHECK (length(encryption_public_key) = 44),
    signing_public_key text NOT NULL CHECK (length(signing_public_key) = 44),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crypto_devices (
    user_id uuid NOT NULL REFERENCES crypto_accounts (user_id) ON DELETE CASCADE,
    id uuid NOT NULL,
    public_key text NOT NULL CHECK (length(public_key) = 44),
    wrapped_keys text NOT NULL DEFAULT '' CHECK (length(wrapped_keys) <= 4096),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id),
    UNIQUE (user_id, public_key)
);

CREATE TABLE crypto_recovery (
    user_id uuid PRIMARY KEY REFERENCES crypto_accounts (user_id) ON DELETE CASCADE,
    wrapped_keys text NOT NULL CHECK (char_length(wrapped_keys) BETWEEN 96 AND 4096)
);

-- Owner-only encrypted records (Lingvo) addressed by HMAC tags

CREATE TABLE private_records (
    user_id uuid NOT NULL REFERENCES crypto_accounts (user_id) ON DELETE CASCADE,
    tag text NOT NULL CHECK (tag ~ '^[0-9a-f]{64}$'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    nonce text NOT NULL CHECK (char_length(nonce) = 16),
    ciphertext text NOT NULL CHECK (char_length(ciphertext) BETWEEN 24 AND 2097152),
    PRIMARY KEY (user_id, tag)
);

-- Fluo

CREATE TABLE fluo_posts (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content jsonb NOT NULL,
    plain_text text NOT NULL CONSTRAINT fluo_posts_text_limit CHECK (octet_length(plain_text) <= 524320),
    visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
    parent_id uuid REFERENCES fluo_posts (id) ON DELETE CASCADE,
    quote_id uuid REFERENCES fluo_posts (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    quote_deleted boolean NOT NULL DEFAULT false,
    CONSTRAINT fluo_posts_reply_or_quote CHECK (parent_id IS NULL OR quote_id IS NULL)
);
CREATE INDEX fluo_posts_timeline_idx ON fluo_posts (created_at DESC, id DESC) WHERE parent_id IS NULL;
CREATE INDEX fluo_posts_author_idx ON fluo_posts (author_id, created_at DESC, id DESC) WHERE parent_id IS NULL;
CREATE INDEX fluo_posts_author_all_idx ON fluo_posts (author_id);
CREATE INDEX fluo_posts_comments_idx ON fluo_posts (parent_id, created_at DESC, id DESC) WHERE parent_id IS NOT NULL;
CREATE INDEX fluo_posts_quote_idx ON fluo_posts (quote_id) WHERE quote_id IS NOT NULL;

CREATE TABLE fluo_post_media (
    post_id uuid NOT NULL REFERENCES fluo_posts (id) ON DELETE CASCADE,
    upload_id uuid NOT NULL,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
    kind text NOT NULL,
    mime_type text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
    alt_text text NOT NULL DEFAULT '',
    PRIMARY KEY (post_id, upload_id),
    UNIQUE (post_id, position),
    CONSTRAINT fluo_post_media_opaque CHECK (kind = 'file' AND width = 0 AND height = 0)
);
CREATE INDEX fluo_post_media_upload_idx ON fluo_post_media (upload_id);

CREATE TABLE fluo_reactions (
    post_id uuid NOT NULL REFERENCES fluo_posts (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    value text NOT NULL CHECK (value IN ('good', 'bad')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE fluo_follows (
    follower_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    followed_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CONSTRAINT fluo_follows_not_self CHECK (follower_id <> followed_id)
);
CREATE INDEX fluo_followers_page_idx ON fluo_follows (followed_id, created_at DESC, follower_id DESC);
CREATE INDEX fluo_following_page_idx ON fluo_follows (follower_id, created_at DESC, followed_id DESC);

CREATE TABLE fluo_saved_posts (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES fluo_posts (id) ON DELETE CASCADE,
    saved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX fluo_saved_posts_timeline_idx ON fluo_saved_posts (user_id, saved_at DESC, post_id DESC);
CREATE INDEX fluo_saved_posts_post_idx ON fluo_saved_posts (post_id);

CREATE TABLE fluo_notifications (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    recipient_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('like', 'dislike', 'reply', 'quote', 'follow', 'unfollow')),
    post_id uuid REFERENCES fluo_posts (id) ON DELETE CASCADE,
    subject_post_id uuid REFERENCES fluo_posts (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    read_at timestamptz,
    CONSTRAINT fluo_notifications_not_self CHECK (recipient_id <> actor_id),
    CONSTRAINT fluo_notifications_post_kind CHECK (
        (kind IN ('follow', 'unfollow') AND post_id IS NULL AND subject_post_id IS NULL)
        OR (kind NOT IN ('follow', 'unfollow') AND post_id IS NOT NULL AND subject_post_id IS NOT NULL)
    )
);
CREATE INDEX fluo_notifications_timeline_idx ON fluo_notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX fluo_notifications_unread_idx ON fluo_notifications (recipient_id, created_at DESC, id DESC) WHERE read_at IS NULL;
CREATE INDEX fluo_notifications_event_lookup_idx ON fluo_notifications (recipient_id, actor_id, kind, post_id, created_at DESC);
CREATE INDEX fluo_notifications_actor_idx ON fluo_notifications (actor_id);
CREATE INDEX fluo_notifications_post_idx ON fluo_notifications (post_id);
CREATE INDEX fluo_notifications_subject_idx ON fluo_notifications (subject_post_id);

CREATE TABLE fluo_settings (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    notify_likes text NOT NULL DEFAULT 'all' CHECK (notify_likes IN ('all', 'off', 'following')),
    notify_dislikes text NOT NULL DEFAULT 'all' CHECK (notify_dislikes IN ('all', 'off', 'following')),
    notify_replies text NOT NULL DEFAULT 'all' CHECK (notify_replies IN ('all', 'off', 'following')),
    notify_follows text NOT NULL DEFAULT 'all' CHECK (notify_follows IN ('all', 'off', 'following')),
    notify_unfollows text NOT NULL DEFAULT 'off' CHECK (notify_unfollows IN ('all', 'off', 'following')),
    notify_quotes text NOT NULL DEFAULT 'all' CHECK (notify_quotes IN ('all', 'off', 'following')),
    account_visibility text NOT NULL DEFAULT 'public' CHECK (account_visibility IN ('public', 'private')),
    show_likes boolean NOT NULL DEFAULT true,
    presence_visibility text NOT NULL DEFAULT 'all' CHECK (presence_visibility IN ('all', 'friends', 'off'))
);

CREATE TABLE fluo_profiles (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
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

CREATE TABLE fluo_profile_images (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    slot text NOT NULL CHECK (slot IN ('avatar', 'banner')),
    upload_id uuid NOT NULL REFERENCES nodo_upload_claims (upload_id),
    mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    width integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
    PRIMARY KEY (user_id, slot),
    CONSTRAINT fluo_profile_images_ratio CHECK (
        (slot = 'avatar' AND width = height) OR (slot = 'banner' AND width = height * 3)
    )
);
CREATE INDEX fluo_profile_images_upload_idx ON fluo_profile_images (upload_id);

-- Fluo audience keys: version 1+ per author, optionally published, otherwise sealed to followed accounts

CREATE TABLE fluo_keyrings (
    owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    public_key text CHECK (public_key IS NULL OR length(public_key) = 44),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, version)
);

CREATE TABLE fluo_keyring_grants (
    owner_id uuid NOT NULL,
    version integer NOT NULL,
    recipient_id uuid NOT NULL REFERENCES crypto_accounts (user_id) ON DELETE CASCADE,
    sealed_key text NOT NULL CHECK (length(sealed_key) = 108),
    PRIMARY KEY (owner_id, version, recipient_id),
    FOREIGN KEY (owner_id, version) REFERENCES fluo_keyrings (owner_id, version) ON DELETE CASCADE
);
CREATE INDEX fluo_keyring_grants_recipient_idx ON fluo_keyring_grants (recipient_id);

-- Ligo conversations; Rondo channels are conversations of kind 'channel'

CREATE TABLE ligo_conversations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    kind text NOT NULL CHECK (kind IN ('duo', 'group', 'self', 'channel')),
    title text NOT NULL DEFAULT '' CHECK (octet_length(title) <= 524320),
    created_by uuid NOT NULL REFERENCES users (id),
    duo_low uuid REFERENCES users (id),
    duo_high uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (duo_low, duo_high),
    CONSTRAINT ligo_conversations_shape CHECK (
        (kind = 'duo' AND duo_low IS NOT NULL AND duo_high IS NOT NULL AND duo_low < duo_high AND title = '')
        OR (kind IN ('group', 'channel') AND duo_low IS NULL AND duo_high IS NULL)
        OR (kind = 'self' AND duo_low IS NULL AND duo_high IS NULL AND title = '')
    )
);
CREATE UNIQUE INDEX ligo_self_owner_idx ON ligo_conversations (created_by) WHERE kind = 'self';

CREATE TABLE ligo_members (
    conversation_id uuid NOT NULL REFERENCES ligo_conversations (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_read_message_id uuid,
    last_delivered_message_id uuid,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX ligo_members_user_idx ON ligo_members (user_id, conversation_id);

CREATE TABLE ligo_messages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    conversation_id uuid NOT NULL REFERENCES ligo_conversations (id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users (id),
    client_id uuid NOT NULL,
    body text NOT NULL CHECK (octet_length(body) <= 524320),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    edited_at timestamptz,
    deleted_at timestamptz,
    system_notice boolean NOT NULL DEFAULT false,
    UNIQUE (sender_id, client_id)
);
CREATE INDEX ligo_messages_page_idx ON ligo_messages (conversation_id, id DESC);
CREATE INDEX ligo_messages_rate_idx ON ligo_messages (sender_id, created_at DESC);

CREATE TABLE ligo_message_media (
    message_id uuid NOT NULL REFERENCES ligo_messages (id) ON DELETE CASCADE,
    upload_id uuid NOT NULL,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 7),
    kind text NOT NULL CHECK (kind IN ('image', 'video', 'file')),
    mime_type text NOT NULL,
    filename text NOT NULL DEFAULT '' CHECK (char_length(filename) <= 120),
    width integer NOT NULL,
    height integer NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
    alt_text text NOT NULL DEFAULT '' CHECK (char_length(alt_text) <= 500),
    PRIMARY KEY (message_id, upload_id),
    UNIQUE (message_id, position),
    CONSTRAINT ligo_message_media_file_name CHECK (kind <> 'file' OR filename <> ''),
    CONSTRAINT ligo_message_media_geometry CHECK (
        (kind = 'file' AND width = 0 AND height = 0)
        OR (kind <> 'file' AND width BETWEEN 1 AND 8192 AND height BETWEEN 1 AND 8192)
    )
);
CREATE INDEX ligo_message_media_upload_idx ON ligo_message_media (upload_id);

CREATE TABLE ligo_message_reactions (
    message_id uuid NOT NULL REFERENCES ligo_messages (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    emoji text NOT NULL CHECK (emoji IN ('❤️', '👍', '👎')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- Rondo

CREATE TABLE rondo_servers (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    name text NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 524320),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
    access text NOT NULL CHECK (access IN ('public', 'private')),
    owner_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX rondo_servers_public_idx ON rondo_servers (created_at DESC, id DESC) WHERE access = 'public';

CREATE TABLE rondo_members (
    server_id uuid NOT NULL REFERENCES rondo_servers (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (server_id, user_id)
);
CREATE INDEX rondo_members_user_idx ON rondo_members (user_id, server_id);

CREATE TABLE rondo_channels (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    server_id uuid NOT NULL REFERENCES rondo_servers (id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL UNIQUE REFERENCES ligo_conversations (id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 524320),
    position integer NOT NULL CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (server_id, name),
    UNIQUE (server_id, position)
);

CREATE TABLE rondo_voice_keys (
    channel_id uuid PRIMARY KEY REFERENCES rondo_channels (id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    membership_tag text NOT NULL CHECK (char_length(membership_tag) = 64),
    envelope jsonb NOT NULL
);

-- Memoro: one opaque document per day tag, grouped by an opaque month tag

CREATE TABLE memoro_days (
    user_id uuid NOT NULL REFERENCES crypto_accounts (user_id) ON DELETE CASCADE,
    day_tag text NOT NULL CHECK (day_tag ~ '^[0-9a-f]{64}$'),
    month_tag text NOT NULL CHECK (month_tag ~ '^[0-9a-f]{64}$'),
    nonce text NOT NULL CHECK (length(nonce) = 16),
    ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 24 AND 2097152),
    summary_nonce text NOT NULL CHECK (length(summary_nonce) = 16),
    summary_ciphertext text NOT NULL CHECK (length(summary_ciphertext) BETWEEN 24 AND 8192),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day_tag)
);
CREATE INDEX memoro_days_month_idx ON memoro_days (user_id, month_tag);

CREATE TABLE memoro_day_media (
    user_id uuid NOT NULL,
    day_tag text NOT NULL,
    upload_id uuid NOT NULL REFERENCES nodo_upload_claims (upload_id),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 17 AND 104857600),
    PRIMARY KEY (user_id, day_tag, upload_id),
    FOREIGN KEY (user_id, day_tag) REFERENCES memoro_days (user_id, day_tag) ON DELETE CASCADE
);
CREATE INDEX memoro_day_media_upload_idx ON memoro_day_media (upload_id);
