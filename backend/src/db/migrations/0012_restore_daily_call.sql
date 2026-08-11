-- Restore the two per-install daily-cap columns on `users`.
--
-- They are created by 0000_init and declared in schema.ts, but the production
-- database had neither: `chargeCredit()` in middleware/credits.ts names both in
-- its WHERE clause, so every `/v1/ai/*` request 500'd with `Unknown column
-- 'daily_call_date' in 'where clause'` — all four engines and the Android
-- bubble at once, surfacing to the user as "The engine choked".
--
-- How they went missing: `db:generate`/`push` diffs against schema.ts, and these
-- two were absent from that file for a while (see the comment on `dailyCallCount`
-- there). The diff read that as DROP COLUMN. schema.ts now declares them, so the
-- diff is closed; this migration puts the columns back.
--
-- Defaults match 0000_init exactly, so a row that never had them behaves like a
-- brand-new install: zero calls used today, NULL date, which `chargeCredit`
-- already treats as "not today" via its `daily_call_date <> ${today}` branch.
--
-- MySQL has no `ADD COLUMN IF NOT EXISTS`, and it does not need one here: the
-- `0012_restore_daily_call` probe in migrate.ts tests for `daily_call_date`, so
-- on a database that never lost the columns this migration is behind the
-- detected baseline and is never run.

ALTER TABLE users ADD COLUMN daily_call_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER analysis_count;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN daily_call_date DATE NULL AFTER daily_call_count;
