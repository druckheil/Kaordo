BEGIN;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ligo_conversations'::regclass
        AND conname = 'ligo_conversations_kind_rondo') THEN
        ALTER TABLE ligo_conversations DROP CONSTRAINT IF EXISTS ligo_conversations_kind_check;
        ALTER TABLE ligo_conversations ADD CONSTRAINT ligo_conversations_kind_rondo
            CHECK (kind IN ('duo', 'group', 'self', 'channel'));
        ALTER TABLE ligo_conversations DROP CONSTRAINT IF EXISTS ligo_conversation_shape;
        ALTER TABLE ligo_conversations ADD CONSTRAINT ligo_conversation_shape_rondo CHECK (
            (kind = 'duo' AND duo_low IS NOT NULL AND duo_high IS NOT NULL AND duo_low < duo_high AND title = '') OR
            (kind = 'group' AND duo_low IS NULL AND duo_high IS NULL) OR
            (kind = 'self' AND duo_low IS NULL AND duo_high IS NULL AND title = '') OR
            (kind = 'channel' AND duo_low IS NULL AND duo_high IS NULL)
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS rondo_servers (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
    access text NOT NULL CHECK (access IN ('public', 'private')),
    owner_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS rondo_servers_public_idx ON rondo_servers (created_at DESC, id DESC) WHERE access = 'public';

CREATE TABLE IF NOT EXISTS rondo_members (
    server_id uuid NOT NULL REFERENCES rondo_servers(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS rondo_members_user_idx ON rondo_members (user_id, server_id);

CREATE TABLE IF NOT EXISTS rondo_channels (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    server_id uuid NOT NULL REFERENCES rondo_servers(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL UNIQUE REFERENCES ligo_conversations(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    position integer NOT NULL CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (server_id, name),
    UNIQUE (server_id, position)
);

COMMIT;
