CREATE TABLE profile_public_allocations (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  profile_id TEXT CHECK(profile_id IS NULL OR length(profile_id) = 36),
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX profile_public_allocations_user_idx
  ON profile_public_allocations(user_id, committed, expires_at);
CREATE INDEX profile_public_allocations_node_idx
  ON profile_public_allocations(node_id, committed, expires_at);
CREATE UNIQUE INDEX profile_public_allocations_profile_idx
  ON profile_public_allocations(user_id, profile_id)
  WHERE profile_id IS NOT NULL;

CREATE TABLE user_profiles (
  user_id BLOB PRIMARY KEY NOT NULL CHECK(length(user_id) = 16),
  allocation_id TEXT NOT NULL CHECK(length(allocation_id) = 36),
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  profile_file_id TEXT NOT NULL CHECK(length(profile_file_id) = 36),
  avatar_file_id TEXT CHECK(avatar_file_id IS NULL OR length(avatar_file_id) = 36),
  avatar_mime_type TEXT CHECK(avatar_mime_type IS NULL OR length(avatar_mime_type) <= 120),
  avatar_size INTEGER NOT NULL DEFAULT 0 CHECK(avatar_size >= 0),
  profile_size INTEGER NOT NULL CHECK(profile_size > 0),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(allocation_id) REFERENCES profile_public_allocations(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT;
