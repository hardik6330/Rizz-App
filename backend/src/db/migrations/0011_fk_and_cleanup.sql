-- Migration 0011: Cleanup legacy limits columns and enforce FK constraints with ON DELETE CASCADE

-- 1. Drop legacy unused daily limit columns from users table
ALTER TABLE `users` DROP COLUMN `daily_call_count`;
ALTER TABLE `users` DROP COLUMN `daily_call_date`;

-- 2. Add foreign key constraints on profile_scans
ALTER TABLE `profile_scans`
  ADD CONSTRAINT `fk_profile_scans_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE;

-- 3. Add foreign key constraints on saved_items
ALTER TABLE `saved_items`
  ADD CONSTRAINT `fk_saved_items_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE;

-- 4. Add foreign key constraints on credit_events
ALTER TABLE `credit_events`
  ADD CONSTRAINT `fk_credit_events_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE;
