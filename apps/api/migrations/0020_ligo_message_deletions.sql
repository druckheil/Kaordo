-- Durable per-device deletion outbox. Message payloads remain on clients/Nodo;
-- D1 only keeps the identifier until each participant acknowledges cleanup.
CREATE TABLE ligo_message_deletions (
  recipient_id BLOB NOT NULL CHECK(length(recipient_id) = 16),
  message_id TEXT NOT NULL CHECK(length(message_id) = 36),
  sender_id BLOB NOT NULL CHECK(length(sender_id) = 16),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_id, message_id),
  FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ligo_message_deletions_created_idx
  ON ligo_message_deletions(recipient_id, created_at, message_id);
