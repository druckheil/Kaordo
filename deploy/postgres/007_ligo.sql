BEGIN;

-- Older local databases used a Fluo-named claim table. Copy retired claims as
-- well as active ones before removing that name; reruns skip this block.
DO $$ BEGIN
    IF to_regclass('public.fluo_upload_claims') IS NOT NULL THEN
        INSERT INTO nodo_upload_claims (upload_id, owner_id, claimed_at, retired_at)
        SELECT upload_id, owner_id, claimed_at, retired_at FROM fluo_upload_claims
        ON CONFLICT (upload_id) DO NOTHING;
        DROP TABLE fluo_upload_claims;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS ligo_conversations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    kind text NOT NULL CHECK (kind IN ('duo', 'group')),
    title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 100),
    created_by uuid NOT NULL REFERENCES users(id),
    duo_low uuid REFERENCES users(id),
    duo_high uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ligo_duo_shape CHECK (
        (kind = 'duo' AND duo_low IS NOT NULL AND duo_high IS NOT NULL AND duo_low < duo_high AND title = '') OR
        (kind = 'group' AND duo_low IS NULL AND duo_high IS NULL)
    ),
    UNIQUE (duo_low, duo_high)
);

CREATE TABLE IF NOT EXISTS ligo_members (
    conversation_id uuid NOT NULL REFERENCES ligo_conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_read_message_id uuid,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS ligo_members_user_idx ON ligo_members (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS ligo_messages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    conversation_id uuid NOT NULL REFERENCES ligo_conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users(id),
    client_id uuid NOT NULL,
    body text NOT NULL CHECK (char_length(body) <= 4000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS ligo_messages_page_idx ON ligo_messages (conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS ligo_messages_rate_idx ON ligo_messages (sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ligo_message_media (
    message_id uuid NOT NULL REFERENCES ligo_messages(id) ON DELETE CASCADE,
    upload_id uuid NOT NULL,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
    kind text NOT NULL CHECK (kind IN ('image', 'video', 'file')),
    mime_type text NOT NULL,
    filename text NOT NULL DEFAULT '' CHECK (char_length(filename) <= 120),
    width integer NOT NULL CHECK ((kind = 'file' AND width = 0) OR (kind <> 'file' AND width BETWEEN 1 AND 8192)),
    height integer NOT NULL CHECK ((kind = 'file' AND height = 0) OR (kind <> 'file' AND height BETWEEN 1 AND 8192)),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
    alt_text text NOT NULL DEFAULT '' CHECK (char_length(alt_text) <= 500),
    CONSTRAINT ligo_file_name CHECK (kind <> 'file' OR filename <> ''),
    PRIMARY KEY (message_id, upload_id),
    UNIQUE (message_id, position)
);
CREATE INDEX IF NOT EXISTS ligo_message_media_upload_idx ON ligo_message_media (upload_id);

COMMIT;
