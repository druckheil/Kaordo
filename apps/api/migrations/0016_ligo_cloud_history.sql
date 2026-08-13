-- A compact index for each account's bounded Ligo cloud window. Message bodies
-- and attachments stay on Nodo; D1 only stores routing and retention metadata.
CREATE TABLE ligo_storage_settings (
  user_id BLOB PRIMARY KEY NOT NULL CHECK(length(user_id) = 16),
  storage_kind INTEGER NOT NULL CHECK(storage_kind IN (0, 1)),
  node_id TEXT CHECK(node_id IS NULL OR length(node_id) = 36),
  stack_limit_bytes INTEGER NOT NULL CHECK(stack_limit_bytes BETWEEN 1048576 AND 10737418240),
  updated_at INTEGER NOT NULL,
  CHECK((storage_kind = 1 AND node_id IS NULL) OR (storage_kind = 0 AND node_id IS NOT NULL)),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE ligo_cloud_messages (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  owner_id BLOB NOT NULL CHECK(length(owner_id) = 16),
  peer_id BLOB NOT NULL CHECK(length(peer_id) = 16),
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  storage_kind INTEGER NOT NULL CHECK(storage_kind IN (0, 1)),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(peer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ligo_cloud_messages_owner_retention_idx
  ON ligo_cloud_messages(owner_id, created_at DESC, id DESC);
CREATE INDEX ligo_cloud_messages_conversation_idx
  ON ligo_cloud_messages(owner_id, peer_id, created_at DESC, id DESC);

-- Deletions are an outbox. The sending desktop usually applies them
-- immediately; Nodo heartbeat reconciliation guarantees eventual cleanup.
CREATE TABLE ligo_cloud_tombstones (
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  message_id TEXT NOT NULL CHECK(length(message_id) = 36),
  owner_id BLOB NOT NULL CHECK(length(owner_id) = 16),
  storage_kind INTEGER NOT NULL CHECK(storage_kind IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(node_id, message_id),
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ligo_cloud_tombstones_created_idx
  ON ligo_cloud_tombstones(created_at);
