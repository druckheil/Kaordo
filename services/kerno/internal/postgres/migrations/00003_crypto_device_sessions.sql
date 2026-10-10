-- Links each device to the sign-in session that last used it and records how it received the account keys
-- +goose Up
ALTER TABLE crypto_devices
    ADD COLUMN session_id text NOT NULL DEFAULT '' CHECK (length(session_id) <= 64),
    ADD COLUMN unlocked_with text NOT NULL DEFAULT '' CHECK (unlocked_with IN ('', 'account', 'device', 'recovery')),
    ADD COLUMN unlocked_at timestamptz;
