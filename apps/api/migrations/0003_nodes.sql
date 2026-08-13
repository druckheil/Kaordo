CREATE TABLE nodes (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  device_name TEXT NOT NULL CHECK(length(device_name) BETWEEN 1 AND 80),
  protocol TEXT NOT NULL CHECK(length(protocol) BETWEEN 1 AND 32),
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  quota_bytes INTEGER NOT NULL CHECK(quota_bytes > 0),
  used_bytes INTEGER NOT NULL CHECK(used_bytes >= 0),
  local_addresses TEXT NOT NULL CHECK(length(local_addresses) <= 2048),
  observed_address TEXT CHECK(observed_address IS NULL OR length(observed_address) <= 64),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX nodes_user_id_idx ON nodes(user_id);
CREATE INDEX nodes_last_seen_at_idx ON nodes(last_seen_at);
