-- Ilo / Taglibroplanilo planner, diary and reminders.  All rows are scoped to
-- the authenticated Kaordo account; Telegram identifiers and bot credentials
-- are intentionally not part of the service schema.
CREATE TABLE ilo_tag_plans (
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  day TEXT NOT NULL CHECK(length(day) = 10),
  plan_id TEXT NOT NULL CHECK(length(plan_id) BETWEEN 8 AND 32),
  position INTEGER NOT NULL CHECK(position >= 0 AND position < 200),
  text TEXT NOT NULL CHECK(length(text) <= 512),
  accent INTEGER NOT NULL DEFAULT 0 CHECK(accent IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, day, plan_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ilo_tag_plans_day_idx ON ilo_tag_plans(user_id, day, position, plan_id);

CREATE TABLE ilo_tag_diary (
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  day TEXT NOT NULL CHECK(length(day) = 10),
  text TEXT NOT NULL DEFAULT '' CHECK(length(text) <= 16_000),
  mood TEXT NOT NULL DEFAULT '🙂' CHECK(length(mood) BETWEEN 1 AND 8),
  plan_state TEXT NOT NULL DEFAULT '{}' CHECK(length(plan_state) <= 16_000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, day),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE ilo_tag_events (
  user_id BLOB NOT NULL CHECK(length(user_id) = 16),
  id TEXT NOT NULL CHECK(length(id) BETWEEN 8 AND 32),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 256),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2_000),
  event_at INTEGER NOT NULL,
  reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK(reminder_enabled IN (0, 1)),
  remind_offset_min INTEGER CHECK(remind_offset_min IS NULL OR remind_offset_min BETWEEN 1 AND 43_200),
  reminder_sent INTEGER NOT NULL DEFAULT 0 CHECK(reminder_sent IN (0, 1)),
  reminder_sent_at INTEGER,
  notify_at_event_time INTEGER NOT NULL DEFAULT 0 CHECK(notify_at_event_time IN (0, 1)),
  notify_sent INTEGER NOT NULL DEFAULT 0 CHECK(notify_sent IN (0, 1)),
  notify_sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX ilo_tag_events_schedule_idx ON ilo_tag_events(user_id, event_at, id);
