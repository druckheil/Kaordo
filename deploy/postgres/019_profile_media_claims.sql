-- Restores owned profile image claims incorrectly retired by migration replay
BEGIN;

-- An existing profile reference keeps Nodo bytes in use. Repair only claims
-- whose owner matches that reference; unreferenced retired uploads stay retired.
UPDATE nodo_upload_claims AS claim SET retired_at = NULL
WHERE claim.retired_at IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM fluo_profile_images AS image
      WHERE image.upload_id = claim.upload_id AND image.user_id = claim.owner_id
  );

COMMIT;
