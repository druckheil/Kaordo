ALTER TABLE nodes ADD COLUMN device_key TEXT
  CHECK(device_key IS NULL OR length(device_key) = 64);

ALTER TABLE nodes ADD COLUMN slot_key TEXT NOT NULL DEFAULT 'primary'
  CHECK(length(slot_key) BETWEEN 1 AND 32);

CREATE UNIQUE INDEX nodes_user_device_slot_idx
  ON nodes(user_id, device_key, slot_key)
  WHERE device_key IS NOT NULL;
