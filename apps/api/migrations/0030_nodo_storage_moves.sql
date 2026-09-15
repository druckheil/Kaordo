-- A short-lived capability for moving one Nodo's physical payloads to another
-- Nodo owned by the same account. The payload bytes stay on the Nodos; D1
-- only coordinates the transfer and updates compact routing metadata.
CREATE TABLE node_storage_moves (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  source_node_id TEXT NOT NULL CHECK(length(source_node_id) = 36),
  target_node_id TEXT NOT NULL CHECK(length(target_node_id) = 36),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK(source_node_id <> target_node_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(target_node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX node_storage_moves_active_idx
  ON node_storage_moves(user_id, source_node_id, target_node_id, expires_at, completed_at);
