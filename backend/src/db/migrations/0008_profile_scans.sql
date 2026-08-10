-- Profile Scans storage (no raw images or screenshots persisted)
CREATE TABLE IF NOT EXISTS profile_scans (
  id           VARCHAR(64)       NOT NULL PRIMARY KEY,
  user_id      CHAR(36)          NOT NULL,
  mode         ENUM('self', 'them') NOT NULL,
  title        VARCHAR(128),
  summary_json JSON              NOT NULL,
  created_at   BIGINT            NOT NULL,
  INDEX idx_ps_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
