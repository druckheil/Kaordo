-- A durable per-participant outbox for deleting an entire local conversation.
-- Payloads are still deleted on clients and Nodo; D1 stores only the peer pair.
CREATE TABLE ligo_conversation_deletions (
  recipient_id BLOB NOT NULL CHECK(length(recipient_id) = 16),
  peer_id BLOB NOT NULL CHECK(length(peer_id) = 16),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_id, peer_id),
  CHECK(recipient_id != peer_id),
  FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(peer_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ligo_conversation_deletions_created_idx
  ON ligo_conversation_deletions(recipient_id, created_at, peer_id);
