CREATE TABLE users (
  id BLOB PRIMARY KEY NOT NULL CHECK(length(id) = 16),
  username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 3 AND 32),
  display_username TEXT NOT NULL CHECK(length(display_username) BETWEEN 3 AND 32),
  password_hash BLOB NOT NULL CHECK(length(password_hash) = 32),
  password_salt BLOB NOT NULL CHECK(length(password_salt) = 16),
  password_algorithm INTEGER NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 1 CHECK(status IN (0, 1, 2)),
  identity_public_key BLOB
) STRICT, WITHOUT ROWID;

CREATE TABLE sessions (
  token_hash BLOB PRIMARY KEY NOT NULL CHECK(length(token_hash) = 32),
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  client_kind INTEGER NOT NULL CHECK(client_kind IN (0, 1)),
  device_name TEXT CHECK(device_name IS NULL OR length(device_name) <= 80),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
