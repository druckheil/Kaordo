-- Records how far Kerno has delivered each host's alert events, so every transition is sent once
-- +goose Up
CREATE TABLE regado_alert_cursors (
    host text PRIMARY KEY CHECK (length(host) BETWEEN 1 AND 64),
    sequence bigint NOT NULL CHECK (sequence >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
