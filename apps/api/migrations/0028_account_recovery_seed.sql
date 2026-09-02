-- Recovery seeds are one-time credentials.  Keep only the digest so the
-- plaintext can never be recovered from D1 after the first presentation.
ALTER TABLE users ADD COLUMN seed_hash BLOB
  CHECK(seed_hash IS NULL OR length(seed_hash) = 32);
ALTER TABLE users ADD COLUMN seed_created_at INTEGER;

CREATE UNIQUE INDEX users_seed_hash_idx
  ON users(seed_hash)
  WHERE seed_hash IS NOT NULL;
