-- Saved Items / Vault storage for logged in users
CREATE TABLE IF NOT EXISTS saved_items (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  category    VARCHAR(32)  NOT NULL,
  text        TEXT         NOT NULL,
  note        VARCHAR(255),
  saved_at    BIGINT       NOT NULL,
  INDEX idx_si_user_saved (user_id, saved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
