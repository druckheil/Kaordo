ALTER TABLE user_profiles
  ADD COLUMN banner_file_id TEXT
    CHECK(banner_file_id IS NULL OR length(banner_file_id) = 36);

ALTER TABLE user_profiles
  ADD COLUMN banner_mime_type TEXT
    CHECK(banner_mime_type IS NULL OR length(banner_mime_type) <= 120);

ALTER TABLE user_profiles
  ADD COLUMN banner_size INTEGER NOT NULL DEFAULT 0
    CHECK(banner_size >= 0);
