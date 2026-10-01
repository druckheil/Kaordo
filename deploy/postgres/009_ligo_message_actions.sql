BEGIN;

ALTER TABLE ligo_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE ligo_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE ligo_members ADD COLUMN IF NOT EXISTS last_delivered_message_id uuid;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'ligo_message_media'::regclass AND conname = 'ligo_message_media_position_eight') THEN
        ALTER TABLE ligo_message_media DROP CONSTRAINT IF EXISTS ligo_message_media_position_check;
        ALTER TABLE ligo_message_media ADD CONSTRAINT ligo_message_media_position_eight
            CHECK (position BETWEEN 0 AND 7);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS ligo_message_reactions (
    message_id uuid NOT NULL REFERENCES ligo_messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji text NOT NULL CHECK (emoji IN ('❤️', '👍', '👎')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (message_id, user_id, emoji)
);

COMMIT;
