CREATE TABLE users (
  id                     CHAR(36)     NOT NULL,
  install_id             CHAR(36)     NOT NULL,
  rc_app_user_id         VARCHAR(128) NULL,
  platform               ENUM('ios','android') NOT NULL,
  app_version            VARCHAR(24)  NULL,
  is_pro                 TINYINT(1)   NOT NULL DEFAULT 0,
  entitlement_expires_at BIGINT       NULL,
  analysis_count         INT UNSIGNED NOT NULL DEFAULT 0,
  daily_call_count       INT UNSIGNED NOT NULL DEFAULT 0,
  daily_call_date        DATE         NULL,
  banned_at              BIGINT       NULL,
  created_at             BIGINT       NOT NULL,
  updated_at             BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_install (install_id),
  UNIQUE KEY uq_users_rc      (rc_app_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE daily_feed (
  feed_date  DATE              NOT NULL,
  version    SMALLINT UNSIGNED NOT NULL,
  items_json JSON              NOT NULL,
  created_at BIGINT            NOT NULL,
  PRIMARY KEY (feed_date, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rc_events (
  event_id   VARCHAR(128) NOT NULL,
  user_id    CHAR(36)     NULL,
  type       VARCHAR(48)  NOT NULL,
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (event_id),
  KEY idx_rc_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
