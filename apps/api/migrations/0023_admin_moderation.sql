-- Administrative moderation and durable cross-Nodo erasure jobs.
-- The target user is intentionally not a foreign key: the account row can be
-- removed as soon as every host acknowledges the job, while an offline Nodo
-- still needs to receive its cleanup command on a later heartbeat.
CREATE TABLE admin_erase_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  node_id TEXT NOT NULL CHECK(length(node_id) = 36),
  target_user_id BLOB NOT NULL CHECK(length(target_user_id) = 16),
  target_username TEXT NOT NULL CHECK(length(target_username) BETWEEN 1 AND 32),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX admin_erase_jobs_node_idx
  ON admin_erase_jobs(node_id, created_at, id);

CREATE INDEX admin_erase_jobs_target_idx
  ON admin_erase_jobs(target_user_id, created_at, id);
