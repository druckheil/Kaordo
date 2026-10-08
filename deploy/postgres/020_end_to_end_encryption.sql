-- Starts device-held encryption: removes plaintext content once and stores only identities, sealed keys and ciphertext
BEGIN;

DROP TABLE IF EXISTS admin_access_cases;

-- Plaintext posts, messages, communities and dictionaries are discarded once; accounts, follows and settings remain.
DO $$
BEGIN
    IF to_regclass('public.content_encryption_epoch') IS NULL THEN
        TRUNCATE fluo_posts, fluo_notifications, ligo_conversations, rondo_servers CASCADE;
        -- Nodo garbage collection removes the bytes once their claims disappear.
        DELETE FROM nodo_upload_claims claim
        WHERE NOT EXISTS (SELECT 1 FROM fluo_profile_images image WHERE image.upload_id = claim.upload_id);
        DROP TABLE IF EXISTS lingvo_reviews, lingvo_cards, lingvo_folders, lingvo_dictionaries CASCADE;
        CREATE TABLE content_encryption_epoch (started_at timestamptz NOT NULL DEFAULT now());
        INSERT INTO content_encryption_epoch DEFAULT VALUES;
    END IF;
END $$;

DROP INDEX IF EXISTS fluo_posts_text_trgm_idx;

CREATE TABLE IF NOT EXISTS crypto_accounts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encryption_public_key text NOT NULL CHECK (length(encryption_public_key) = 44),
    signing_public_key text NOT NULL CHECK (length(signing_public_key) = 44),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crypto_devices (
    user_id uuid NOT NULL REFERENCES crypto_accounts(user_id) ON DELETE CASCADE,
    id uuid NOT NULL,
    public_key text NOT NULL CHECK (length(public_key) = 44),
    wrapped_keys text NOT NULL DEFAULT '' CHECK (length(wrapped_keys) <= 4096),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id),
    UNIQUE (user_id, public_key)
);
CREATE TABLE IF NOT EXISTS crypto_recovery (
    user_id uuid PRIMARY KEY REFERENCES crypto_accounts(user_id) ON DELETE CASCADE,
    wrapped_keys text NOT NULL CHECK (char_length(wrapped_keys) BETWEEN 96 AND 4096)
);

-- Lingvo dictionaries and other owner-only data are opaque records addressed by HMAC tags.
CREATE TABLE IF NOT EXISTS private_records (
    user_id uuid NOT NULL REFERENCES crypto_accounts(user_id) ON DELETE CASCADE,
    tag text NOT NULL CHECK (tag ~ '^[0-9a-f]{64}$'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    nonce text NOT NULL CHECK (char_length(nonce) = 16),
    ciphertext text NOT NULL CHECK (char_length(ciphertext) BETWEEN 24 AND 2097152),
    PRIMARY KEY (user_id, tag)
);

CREATE TABLE IF NOT EXISTS memoro_days (
    user_id uuid NOT NULL REFERENCES crypto_accounts(user_id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS memoro_days_month_idx ON memoro_days(user_id, month_tag);
CREATE TABLE IF NOT EXISTS memoro_day_media (
    user_id uuid NOT NULL,
    day_tag text NOT NULL,
    upload_id uuid NOT NULL REFERENCES nodo_upload_claims(upload_id),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 17 AND 104857600),
    PRIMARY KEY (user_id, day_tag, upload_id),
    FOREIGN KEY (user_id, day_tag) REFERENCES memoro_days(user_id, day_tag) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memoro_day_media_upload_idx ON memoro_day_media(upload_id);

-- Version 0 is each author's self-only key and is never stored; published keys make public accounts readable.
CREATE TABLE IF NOT EXISTS fluo_keyrings (
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    public_key text CHECK (public_key IS NULL OR length(public_key) = 44),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, version)
);
CREATE TABLE IF NOT EXISTS fluo_keyring_grants (
    owner_id uuid NOT NULL,
    version integer NOT NULL,
    recipient_id uuid NOT NULL REFERENCES crypto_accounts(user_id) ON DELETE CASCADE,
    sealed_key text NOT NULL CHECK (length(sealed_key) = 108),
    PRIMARY KEY (owner_id, version, recipient_id),
    FOREIGN KEY (owner_id, version) REFERENCES fluo_keyrings(owner_id, version) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fluo_keyring_grants_recipient_idx ON fluo_keyring_grants(recipient_id);

CREATE TABLE IF NOT EXISTS rondo_voice_keys (
    channel_id uuid PRIMARY KEY REFERENCES rondo_channels(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    membership_tag text NOT NULL CHECK (char_length(membership_tag) = 64),
    envelope jsonb NOT NULL
);

-- Encrypted envelopes replace plaintext bodies; attachments are opaque files described inside the ciphertext.
ALTER TABLE fluo_posts DROP CONSTRAINT IF EXISTS fluo_post_text_limit;
ALTER TABLE fluo_posts ADD CONSTRAINT fluo_post_text_limit CHECK (octet_length(plain_text) <= 524320);
ALTER TABLE fluo_posts DROP COLUMN IF EXISTS encryption_pending;
ALTER TABLE ligo_messages DROP CONSTRAINT IF EXISTS ligo_messages_body_check;
ALTER TABLE ligo_messages ADD CONSTRAINT ligo_messages_body_check CHECK (octet_length(body) <= 524320);
ALTER TABLE ligo_conversations DROP CONSTRAINT IF EXISTS ligo_conversations_title_check;
ALTER TABLE ligo_conversations ADD CONSTRAINT ligo_conversations_title_check CHECK (octet_length(title) <= 524320);
ALTER TABLE rondo_servers DROP CONSTRAINT IF EXISTS rondo_servers_name_check;
ALTER TABLE rondo_servers ADD CONSTRAINT rondo_servers_name_check CHECK (octet_length(name) BETWEEN 1 AND 524320);
ALTER TABLE rondo_channels DROP CONSTRAINT IF EXISTS rondo_channels_name_check;
ALTER TABLE rondo_channels ADD CONSTRAINT rondo_channels_name_check CHECK (octet_length(name) BETWEEN 1 AND 524320);
ALTER TABLE fluo_post_media DROP CONSTRAINT IF EXISTS fluo_post_media_kind_check;
ALTER TABLE fluo_post_media DROP CONSTRAINT IF EXISTS fluo_post_media_width_check;
ALTER TABLE fluo_post_media DROP CONSTRAINT IF EXISTS fluo_post_media_height_check;
ALTER TABLE fluo_post_media DROP CONSTRAINT IF EXISTS fluo_post_media_opaque;
ALTER TABLE fluo_post_media ADD CONSTRAINT fluo_post_media_opaque CHECK (kind = 'file' AND width = 0 AND height = 0);

COMMIT;
