CREATE TABLE fluo_public_allocations (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  post_id TEXT CHECK(post_id IS NULL OR length(post_id) = 36),
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX fluo_public_allocations_user_idx
  ON fluo_public_allocations(user_id, committed, expires_at);
CREATE INDEX fluo_public_allocations_node_idx
  ON fluo_public_allocations(node_id, committed, expires_at);
CREATE UNIQUE INDEX fluo_public_allocations_post_idx
  ON fluo_public_allocations(node_id, post_id)
  WHERE post_id IS NOT NULL;
