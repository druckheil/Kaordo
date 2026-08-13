-- Ligo keeps only delivery pointers and compact conversation previews in D1.
-- Message bodies and attachments remain on Nodo until both clients have local copies.
CREATE TABLE ligo_conversations (
  user_low_id BLOB NOT NULL CHECK(length(user_low_id) = 16),
  user_high_id BLOB NOT NULL CHECK(length(user_high_id) = 16),
  last_message_id TEXT NOT NULL CHECK(length(last_message_id) = 36),
  last_sender_id BLOB NOT NULL CHECK(length(last_sender_id) = 16),
  last_preview TEXT NOT NULL CHECK(length(last_preview) <= 160),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK(user_low_id < user_high_id),
  FOREIGN KEY(user_low_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(user_high_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(last_sender_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ligo_conversations_low_page_idx
  ON ligo_conversations(user_low_id, updated_at DESC, last_message_id DESC);
CREATE INDEX ligo_conversations_high_page_idx
  ON ligo_conversations(user_high_id, updated_at DESC, last_message_id DESC);

CREATE TABLE ligo_deliveries (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  sender_id BLOB NOT NULL CHECK(length(sender_id) = 16),
  recipient_id BLOB NOT NULL CHECK(length(recipient_id) = 16),
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  storage_kind INTEGER NOT NULL CHECK(storage_kind IN (0, 1)),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ligo_deliveries_recipient_page_idx
  ON ligo_deliveries(recipient_id, created_at ASC, id ASC);
CREATE INDEX ligo_deliveries_sender_idx
  ON ligo_deliveries(sender_id, created_at DESC, id DESC);
