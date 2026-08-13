ALTER TABLE nodes ADD COLUMN public_quota_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN private_quota_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN public_used_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN private_used_bytes INTEGER NOT NULL DEFAULT 0;

UPDATE nodes
SET private_quota_bytes = quota_bytes,
    private_used_bytes = used_bytes;
