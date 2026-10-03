BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS user_roles (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('admin')),
    granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS admin_audit (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    actor_id uuid NOT NULL REFERENCES users(id),
    target_user_id uuid REFERENCES users(id),
    action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
    reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS admin_audit_recent_idx ON admin_audit (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS admin_access_cases (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    actor_id uuid NOT NULL REFERENCES users(id),
    target_user_id uuid NOT NULL REFERENCES users(id),
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '15 minutes'),
    CONSTRAINT admin_access_not_self CHECK (actor_id <> target_user_id)
);
CREATE INDEX IF NOT EXISTS admin_access_recent_idx ON admin_access_cases (actor_id, created_at DESC);

ALTER TABLE ligo_messages ADD COLUMN IF NOT EXISTS system_notice boolean NOT NULL DEFAULT false;

COMMIT;
