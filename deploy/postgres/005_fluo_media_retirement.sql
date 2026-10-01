BEGIN;

ALTER TABLE fluo_upload_claims ADD COLUMN IF NOT EXISTS retired_at timestamptz;

-- Existing claims without post references cannot be reused safely once Nodo
-- starts deleting unreferenced bytes. Retire them before enabling the guard.
UPDATE fluo_upload_claims AS claim
SET retired_at = now()
WHERE claim.retired_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM fluo_post_media AS media WHERE media.upload_id = claim.upload_id
  );

COMMIT;
