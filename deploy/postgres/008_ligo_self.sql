BEGIN;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ligo_conversations'::regclass
        AND conname = 'ligo_conversation_shape') THEN
        ALTER TABLE ligo_conversations DROP CONSTRAINT IF EXISTS ligo_duo_shape;
        ALTER TABLE ligo_conversations ADD CONSTRAINT ligo_conversation_shape CHECK (
            (kind = 'duo' AND duo_low IS NOT NULL AND duo_high IS NOT NULL AND duo_low < duo_high AND title = '') OR
            (kind = 'group' AND duo_low IS NULL AND duo_high IS NULL) OR
            (kind = 'self' AND duo_low IS NULL AND duo_high IS NULL AND title = '')
        );
        ALTER TABLE ligo_conversations DROP CONSTRAINT IF EXISTS ligo_conversations_kind_check;
        ALTER TABLE ligo_conversations ADD CONSTRAINT ligo_conversations_kind_check CHECK (kind IN ('duo', 'group', 'self'));
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ligo_self_owner_idx ON ligo_conversations (created_by) WHERE kind = 'self';

COMMIT;
