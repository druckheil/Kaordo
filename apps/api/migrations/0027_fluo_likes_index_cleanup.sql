-- The WITHOUT ROWID primary key already begins with
-- (node_id, space, post_id), so this index duplicates every reaction write
-- without improving the aggregate lookup used by Fluo.
DROP INDEX IF EXISTS fluo_post_likes_post_idx;
