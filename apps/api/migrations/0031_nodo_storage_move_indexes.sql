-- Keep the cross-Nodo route rewrite bounded to the affected host. These
-- tables are normally read by user or content id, while a storage move updates
-- every row belonging to the source node.
CREATE INDEX ligo_cloud_messages_node_idx
  ON ligo_cloud_messages(node_id);

CREATE INDEX ligo_deliveries_node_idx
  ON ligo_deliveries(node_id);

CREATE INDEX ligo_storage_settings_node_idx
  ON ligo_storage_settings(node_id);

CREATE INDEX rondo_room_routes_node_idx
  ON rondo_room_routes(node_id);

CREATE INDEX user_profiles_node_idx
  ON user_profiles(node_id);

CREATE INDEX node_storage_moves_owner_active_idx
  ON node_storage_moves(user_id, completed_at, expires_at, source_node_id, target_node_id);

CREATE INDEX node_storage_moves_source_active_idx
  ON node_storage_moves(source_node_id, expires_at, user_id)
  WHERE completed_at IS NULL;

CREATE INDEX node_storage_moves_target_active_idx
  ON node_storage_moves(target_node_id, expires_at, user_id)
  WHERE completed_at IS NULL;
