-- Preserve messages that were still waiting for their recipient when the
-- bounded cloud-history model was introduced. Previously delivered messages
-- had already been removed from Nodo and are intentionally not recreated.
INSERT OR IGNORE INTO ligo_cloud_messages
  (id, owner_id, peer_id, node_id, storage_kind, size_bytes, created_at)
SELECT id, sender_id, recipient_id, node_id, storage_kind, size_bytes, created_at * 1000
  FROM ligo_deliveries;
