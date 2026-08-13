-- Rondo keeps only a compact room-to-Nodo route in D1. Message bodies and
-- their cursor indexes live on the selected Nodo.
CREATE TABLE rondo_room_routes (
  room_id TEXT PRIMARY KEY NOT NULL CHECK(length(room_id) = 36),
  space_id TEXT NOT NULL CHECK(length(space_id) = 36),
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  storage_kind INTEGER NOT NULL CHECK(storage_kind IN (0, 1)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(room_id) REFERENCES rondo_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(space_id) REFERENCES rondo_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX rondo_room_routes_space_idx
  ON rondo_room_routes(space_id, room_id);

