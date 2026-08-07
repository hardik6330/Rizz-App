-- H-3 · rc_events.user_id was too small for what it actually stores.
--
-- The column is CHAR(36) — sized for a `users.id` UUID — but the route writes
-- RevenueCat's `app_user_id` into it. That is `users.id` today, because the app
-- calls Purchases.logIn(). Any row written before that change, and every sandbox
-- tester, carries `$RCAnonymousID:<32 hex>` = 46 characters. Under MySQL strict
-- mode that is ER_DATA_TOO_LONG, thrown at the idempotency INSERT — so the whole
-- webhook 500s, RevenueCat retries five times, fails identically each time, and
-- abandons the event. Widened to match `users.rc_app_user_id`.
ALTER TABLE rc_events MODIFY user_id VARCHAR(128) NULL;
--> statement-breakpoint

-- H-2 · An append-only record of every credit movement.
--
-- `users.analysis_count` is a bare counter, so "it took two credits and gave me
-- one answer" could not be investigated and could only be fixed by hand-editing
-- a row. It also cannot see the failure it most needs to: a process killed
-- between chargeCredit() and refundCredit() burns a credit with no trace, and
-- Vercel has no SIGTERM at all.
--
-- The counter stays authoritative — this is evidence, not state. Nothing reads
-- it in the request path, which is why the writes are fire-and-forget.
CREATE TABLE credit_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    CHAR(36)        NOT NULL,
  -- +1 charge, -1 refund. TINYINT SIGNED, because a refund is a negative.
  delta      TINYINT         NOT NULL,
  -- 'charge' | 'generation_failed' | 'not_a_profile' — a fixed vocabulary, never
  -- user content. Same rule as lib/logger.ts.
  reason     VARCHAR(32)     NOT NULL,
  created_at BIGINT          NOT NULL,
  PRIMARY KEY (id),
  -- The only query this table will ever serve: "what happened to this user,
  -- newest first". Composite so it is answered from the index alone.
  KEY idx_ce_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint

-- H-1 · Replay protection for the credit-charging endpoints.
--
-- A client retry after a network timeout charged a second credit for one user
-- action — and on the free tier that is a third of the trial, spent on a flaky
-- connection at the exact moment the user is deciding whether the product works.
--
-- Keyed by `<user_id>:<Idempotency-Key>` so one user's key cannot collide with
-- another's. `status = 0` means claimed-but-unfinished, which is how a
-- concurrent duplicate is told apart from a completed one.
CREATE TABLE idempotency (
  id         VARCHAR(200)      NOT NULL,
  -- HTTP status of the stored response. 0 = in flight.
  status     SMALLINT UNSIGNED NOT NULL,
  -- MEDIUMTEXT: a profile report is a few KB of prose, well past TEXT's 64KB
  -- only in pathological cases, but the headroom costs nothing on a table that
  -- is swept daily.
  body       MEDIUMTEXT        NULL,
  created_at BIGINT            NOT NULL,
  PRIMARY KEY (id),
  -- Supports the retention sweep; without it that DELETE is a full scan.
  KEY idx_idem_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
