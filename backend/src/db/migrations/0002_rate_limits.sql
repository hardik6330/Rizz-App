-- Shared token buckets for /v1/auth/*.
--
-- The in-process Map this replaces was per-instance, which on a serverless
-- target means the platform silently multiplies every credential limit by the
-- number of warm lambdas. With no password reset in this product, a
-- brute-forced account is gone permanently, so that limit has to be shared.
-- Everything outside /v1/auth/* still uses the in-process bucket on purpose —
-- see middleware/rateLimit.ts.
--
-- `tokens` is DOUBLE, not INT: the login bucket refills at 0.05/sec, so an
-- integer column would round every refill to zero and the bucket would never
-- recover.
CREATE TABLE rate_limits (
  bucket     VARCHAR(160) NOT NULL,
  tokens     DOUBLE       NOT NULL,
  updated_at BIGINT       NOT NULL,
  PRIMARY KEY (bucket),
  -- Supports the idle sweep in dbRateLimit(); without it that DELETE is a
  -- full scan on a table keyed by every IP that ever touched /v1/auth/*.
  KEY idx_rl_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
