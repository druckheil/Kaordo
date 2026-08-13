CREATE TABLE rondo_spaces (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  owner_user_id BLOB NOT NULL CHECK(length(owner_user_id) = 16),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 48),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 180),
  primary_node_id TEXT,
  primary_node_space INTEGER NOT NULL CHECK(primary_node_space IN (0, 1)),
  quota_bytes INTEGER NOT NULL CHECK(quota_bytes >= 0),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0 AND used_bytes <= quota_bytes),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(primary_node_id) REFERENCES nodes(id) ON DELETE SET NULL
) STRICT;

CREATE UNIQUE INDEX rondo_one_public_space_per_owner_idx
  ON rondo_spaces(owner_user_id)
  WHERE primary_node_space = 1;

CREATE INDEX rondo_spaces_primary_node_idx
  ON rondo_spaces(primary_node_id, primary_node_space);

CREATE TABLE rondo_members (
  space_id TEXT NOT NULL,
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  role INTEGER NOT NULL DEFAULT 0 CHECK(role IN (0, 1)),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(space_id, user_id),
  FOREIGN KEY(space_id) REFERENCES rondo_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX rondo_members_user_idx
  ON rondo_members(user_id, joined_at);

CREATE TABLE rondo_invites (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  space_id TEXT NOT NULL,
  code_hash BLOB NOT NULL UNIQUE CHECK(length(code_hash) = 32),
  created_by BLOB NOT NULL CHECK(length(created_by) = 16),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER NOT NULL DEFAULT 0 CHECK(max_uses >= 0),
  uses INTEGER NOT NULL DEFAULT 0 CHECK(uses >= 0),
  FOREIGN KEY(space_id) REFERENCES rondo_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX rondo_invites_space_idx ON rondo_invites(space_id);
