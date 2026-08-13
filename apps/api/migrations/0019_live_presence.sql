-- Online means that at least one Kaordo application instance currently has
-- an active hibernatable WebSocket. Regular API activity remains last_seen_at.
ALTER TABLE users
  ADD COLUMN online INTEGER NOT NULL DEFAULT 0 CHECK(online IN (0, 1));
