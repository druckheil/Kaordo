CREATE TABLE node_access_tickets (
  token_hash BLOB PRIMARY KEY NOT NULL CHECK(length(token_hash) = 32),
  node_id TEXT NOT NULL,
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX node_access_tickets_expiry_idx ON node_access_tickets(expires_at);
