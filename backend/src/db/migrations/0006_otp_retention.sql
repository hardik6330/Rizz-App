-- A guaranteed upper bound on how long an unused code can sit in the table.
--
-- ## What was already true
--
-- A code that gets USED is deleted the instant it is verified — `verifyOtp` is a
-- single DELETE whose predicate carries the hash, so "check it and burn it" is
-- one atomic operation and there is no window in which a spent code still
-- exists. That needs nothing from this migration.
--
-- A code that is never used expires after ten minutes and is then deleted by the
-- opportunistic sweep in lib/otp.ts. The word doing the work there is
-- OPPORTUNISTIC: that sweep is triggered by a request, throttled to once every
-- thirty minutes per instance. So on a service with traffic, rows are gone
-- within the hour — and on a quiet one, or on a serverless instance that never
-- gets another `/otp` call, they sit there indefinitely. Long-dead rows holding
-- an email address and the hash of a credential is not a state to leave to luck.
--
-- ## What this adds
--
-- A backstop that does not depend on traffic, on a platform's scheduler, or on
-- which instance happens to be warm. `event_scheduler` is ON on this server, so
-- the database cleans up after itself whether or not anything is calling it, and
-- whether requests are served from Vercel, Render or a laptop.
--
-- A MySQL EVENT rather than node-cron (already a dependency, and used nowhere)
-- or a Vercel Cron: the deploy target is serverless, so an in-process timer
-- fires only if an instance happens to be alive — which is the exact assumption
-- that made the opportunistic sweep insufficient. A Vercel Cron would work but
-- costs a route, a shared secret to authenticate it, and a second thing to
-- configure per environment, all to run one DELETE.
--
-- The predicate is `expires_at`, not `created_at`, because that is the indexed
-- column (`idx_otp_expires`) and an unindexed daily scan takes gap locks across
-- a table with a hot INSERT. They differ by exactly the ten-minute TTL, so this
-- deletes at 7 days + 10 minutes after issue rather than 7 days flat — a
-- difference with no meaning at this scale.
--
-- LIMIT for the same reason every other sweep in this codebase has one. It runs
-- daily, and the opportunistic sweep means it will nearly always find nothing,
-- so a bound this wide is a runaway guard rather than a real cap.
--
-- IF NOT EXISTS so re-running against a database that already has it is a no-op.
CREATE EVENT IF NOT EXISTS ev_email_otps_gc
  ON SCHEDULE EVERY 1 DAY
  -- ON COMPLETION PRESERVE: without it MySQL DROPS a one-shot event after it
  -- runs. Harmless on a recurring schedule, and the habit is worth keeping.
  ON COMPLETION PRESERVE
  ENABLE
  COMMENT 'Unverified OTP retention ceiling — see migration 0006'
  DO
    DELETE FROM email_otps
     WHERE expires_at < (UNIX_TIMESTAMP() * 1000) - 604800000
     LIMIT 50000;
