-- Foreign keys with ON DELETE CASCADE on the three user-scoped child tables.
--
-- ## What this migration used to do, and why half of it was removed
--
-- It opened with two `ALTER TABLE users DROP COLUMN` statements against
-- `daily_call_count` and `daily_call_date`. Those columns are read AND written
-- by `chargeCredit()` and `refundCredit()` in `middleware/credits.ts` on every
-- single `/v1/ai/*` request. Applying that version would have produced `Unknown
-- column` on every generation, which the client cannot tell apart from an
-- outage: all four engines fall through to their mock seeds and the Android
-- bubble toasts "not connected yet". One migration, four symptoms, no error the
-- user can act on.
--
-- It never fired only because the migration was invisible — absent from
-- `meta/_journal.json` and from the `PROBES` list in `migrate.ts`, so
-- `drizzle-kit migrate` could not see the file at all. That is not a safety net,
-- it is a coin that had not been flipped yet.
--
-- ## Why the columns stay, rather than the code being changed to drop them
--
-- They implement `DAILY_CALL_CAP` (lib/limits.ts), and that cap is the ONLY
-- ceiling that applies to a Pro account. `analysis_count` gates the free tier
-- and stops mattering the moment `is_pro` is set, so with these gone "unlimited"
-- becomes literally unbounded: one compromised or shared account can run up a
-- Gemini bill with nothing in the request path to stop it.
--
-- That is true in general and load-bearing right now specifically, because
-- `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is still a stub — every build in
-- existence grants Pro for free after a fake purchase sheet. Today, the daily
-- cap is not a backstop behind the paywall. It IS the paywall.
--
-- Removing them is a real option once entitlement is genuinely enforced and
-- there is revenue to absorb an abuse spike. It is a deliberate change to the
-- cost model, and it belongs in its own migration alongside the `credits.ts`
-- edit that makes it safe — not as line 4 of a migration named "fk and cleanup".
--
-- ## What remains
--
-- The foreign keys, which are worth having on their own. `DELETE /v1/user/me`
-- currently names every child table by hand in one transaction, and AGENTS.md
-- carries a standing warning that a new user-scoped table is only deleted if
-- somebody remembers to add a line. Cascades make the database enforce that
-- instead of a comment. The hand-written deletes stay for now — they are
-- idempotent, they work whether or not this migration has run, and removing
-- them is a separate change to make once this is applied everywhere.
--
-- The collation MODIFYs are not cosmetic: InnoDB refuses a foreign key whose
-- child column does not match the parent's type and collation exactly, and
-- `users.id` is CHAR(36) utf8mb4_0900_ai_ci.
--
-- Orphan rows are deleted first for the same reason — the constraint cannot be
-- added while a row violates it. There should be none: `DELETE /v1/user/me`
-- has always cleaned these up. Rows predating that route are what this catches.

-- Align child user_id type + collation with users.id.
ALTER TABLE `profile_scans` MODIFY `user_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;
--> statement-breakpoint
ALTER TABLE `saved_items` MODIFY `user_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;
--> statement-breakpoint
ALTER TABLE `credit_events` MODIFY `user_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;
--> statement-breakpoint

-- Clear orphans, or the ADD CONSTRAINT below fails.
DELETE FROM `profile_scans` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);
--> statement-breakpoint
DELETE FROM `saved_items` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);
--> statement-breakpoint
DELETE FROM `credit_events` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);
--> statement-breakpoint

ALTER TABLE `profile_scans`
  ADD CONSTRAINT `fk_profile_scans_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `saved_items`
  ADD CONSTRAINT `fk_saved_items_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `credit_events`
  ADD CONSTRAINT `fk_credit_events_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE;
