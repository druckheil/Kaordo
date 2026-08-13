CREATE TABLE fluo_public_tombstones (
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  post_id TEXT NOT NULL CHECK(length(post_id) = 36),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(node_id, post_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX fluo_public_tombstones_created_idx
  ON fluo_public_tombstones(created_at);
