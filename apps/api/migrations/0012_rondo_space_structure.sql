ALTER TABLE rondo_spaces
  ADD COLUMN public_quota_bytes INTEGER NOT NULL DEFAULT 0 CHECK(public_quota_bytes >= 0);

UPDATE rondo_spaces
   SET public_quota_bytes = quota_bytes
 WHERE primary_node_space = 1;

DROP INDEX rondo_one_public_space_per_owner_idx;

CREATE UNIQUE INDEX rondo_one_public_space_per_owner_idx
  ON rondo_spaces(owner_user_id)
  WHERE public_quota_bytes > 0;

CREATE TABLE rondo_space_nodes (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  space_id TEXT NOT NULL,
  node_id TEXT,
  storage_kind INTEGER NOT NULL CHECK(storage_kind IN (0, 1)),
  position INTEGER NOT NULL CHECK(position >= 0),
  quota_bytes INTEGER NOT NULL CHECK(quota_bytes >= 0),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0 AND used_bytes <= quota_bytes),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(space_id) REFERENCES rondo_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL,
  UNIQUE(space_id, position)
) STRICT;

CREATE UNIQUE INDEX rondo_space_nodes_node_idx
  ON rondo_space_nodes(space_id, node_id)
  WHERE node_id IS NOT NULL;

CREATE INDEX rondo_space_nodes_capacity_idx
  ON rondo_space_nodes(node_id, storage_kind);

INSERT INTO rondo_space_nodes
  (id, space_id, node_id, storage_kind, position, quota_bytes, used_bytes, created_at)
SELECT id, id, primary_node_id, primary_node_space, 0, quota_bytes, used_bytes, created_at
  FROM rondo_spaces;

CREATE TABLE rondo_rooms (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  space_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 48),
  position INTEGER NOT NULL CHECK(position >= 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(space_id) REFERENCES rondo_spaces(id) ON DELETE CASCADE,
  UNIQUE(space_id, position)
) STRICT;

CREATE INDEX rondo_rooms_space_idx ON rondo_rooms(space_id, position);

INSERT INTO rondo_rooms (id, space_id, name, position, created_at)
SELECT id, id, 'general', 0, created_at FROM rondo_spaces;
