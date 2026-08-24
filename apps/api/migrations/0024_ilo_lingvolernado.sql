-- Ilo / Lingvolernado vocabulary state.  The payload is compact metadata owned
-- by the authenticated account; no Telegram identifiers or bot credentials are
-- stored here.
CREATE TABLE ilo_profiles (
  user_id BLOB PRIMARY KEY NOT NULL CHECK(length(user_id) = 16),
  native_label TEXT NOT NULL DEFAULT 'russian' CHECK(length(native_label) BETWEEN 1 AND 32),
  onboarded INTEGER NOT NULL DEFAULT 0 CHECK(onboarded IN (0, 1)),
  task_cursor INTEGER NOT NULL DEFAULT 0 CHECK(task_cursor >= 0),
  last_study_date TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE ilo_cards (
  id TEXT NOT NULL CHECK(length(id) BETWEEN 8 AND 32),
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  german TEXT NOT NULL CHECK(length(german) BETWEEN 1 AND 256),
  translation TEXT NOT NULL CHECK(length(translation) BETWEEN 1 AND 512),
  theme TEXT NOT NULL DEFAULT 'other' CHECK(length(theme) BETWEEN 1 AND 32),
  article TEXT NOT NULL DEFAULT '',
  plural TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  stage INTEGER NOT NULL DEFAULT 0 CHECK(stage BETWEEN 0 AND 8),
  next_review_at INTEGER NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ilo_cards_due_idx ON ilo_cards(user_id, next_review_at, id);
CREATE INDEX ilo_cards_theme_idx ON ilo_cards(user_id, theme, updated_at, id);

CREATE TABLE ilo_daily_points (
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  day TEXT NOT NULL CHECK(length(day) = 10),
  points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
  PRIMARY KEY(user_id, day),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ilo_daily_points_day_idx ON ilo_daily_points(user_id, day);
