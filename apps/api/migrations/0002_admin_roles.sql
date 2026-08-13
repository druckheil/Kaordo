ALTER TABLE users
  ADD COLUMN role INTEGER NOT NULL DEFAULT 0 CHECK(role IN (0, 1, 2));

ALTER TABLE users
  ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;

UPDATE users
   SET role = 2
 WHERE username = 'druckheil';

UPDATE users
   SET last_seen_at = created_at
 WHERE last_seen_at = 0;
