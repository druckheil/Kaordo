-- Initializes media retirement once without replaying historical orphan cleanup
BEGIN;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'nodo_upload_claims' AND column_name = 'retired_at'
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE nodo_upload_claims ADD COLUMN retired_at timestamptz;

    -- Retire historical orphans only when introducing the guard. Later migrations
    -- add reference types that this historical backfill cannot know about.
    IF to_regclass('public.ligo_message_media') IS NULL THEN
        UPDATE nodo_upload_claims AS claim SET retired_at = now()
        WHERE claim.retired_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM fluo_post_media AS media WHERE media.upload_id = claim.upload_id);
    ELSE
        UPDATE nodo_upload_claims AS claim SET retired_at = now()
        WHERE claim.retired_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM fluo_post_media AS media WHERE media.upload_id = claim.upload_id)
          AND NOT EXISTS (SELECT 1 FROM ligo_message_media AS media WHERE media.upload_id = claim.upload_id);
    END IF;
END $$;

COMMIT;
