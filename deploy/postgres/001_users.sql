CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    keycloak_sub text NOT NULL UNIQUE,
    username text NOT NULL,
    display_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_subject_nonempty CHECK (length(keycloak_sub) > 0),
    CONSTRAINT users_username_nonempty CHECK (length(username) > 0)
);

CREATE INDEX IF NOT EXISTS users_username_idx ON users (lower(username));
