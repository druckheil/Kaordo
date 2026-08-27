-- Compact coordinator metadata for Fluo reactions. The post payload remains
-- on Nodo; this table only records who liked which immutable post identity.
CREATE TABLE fluo_post_likes (
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  space TEXT NOT NULL CHECK(space IN ('private', 'public')),
  post_id TEXT NOT NULL CHECK(length(post_id) = 36),
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(node_id, space, post_id, user_id),
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX fluo_post_likes_post_idx
  ON fluo_post_likes(node_id, space, post_id, created_at);

CREATE INDEX fluo_post_likes_user_idx
  ON fluo_post_likes(user_id, created_at);
