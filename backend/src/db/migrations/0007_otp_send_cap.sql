-- A daily send cap per email address, and the reason `email_otps` rows now
-- outlive their codes.
--
-- ## The hole this closes
--
-- `/v1/auth/otp` had two limiters and they covered two different attacks:
-- the IP token bucket in app.ts (4 tokens, one back every ~50s) stops ONE host
-- mailing a thousand people, and RESEND_COOLDOWN_MS in lib/otp.ts stops a
-- thousand hosts mailing ONE person quickly.
--
-- Neither bounds the TOTAL. An attacker rotating IPs and pacing to the 60-second
-- cooldown delivers 1,440 emails a day to one victim's inbox — every one of them
-- billed to us, delivered from our sending domain, and reported as spam by the
-- person receiving them. The cooldown made it slow; nothing made it stop.
--
-- ## Shape
--
-- A fixed 24h window rather than a sliding one: two columns, no history table,
-- and the failure mode of a fixed window (up to 2× the cap across a boundary) is
-- irrelevant when the cap is a courtesy limit on somebody's inbox rather than a
-- security boundary.
--
-- `window_start` is separate from `created_at` on purpose. `created_at` is the
-- cooldown clock and moves on EVERY send; if the counter reset with it, the cap
-- would never be reached.
ALTER TABLE email_otps
  -- Sends inside the current window. SMALLINT: the cap is single digits.
  ADD COLUMN sends        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  -- Start of the current 24h window. 0 on existing rows, which is older than any
  -- window and therefore reads as "expired" — the first send after this migration
  -- opens a fresh window rather than inheriting a bogus one.
  ADD COLUMN window_start BIGINT            NOT NULL DEFAULT 0;
--> statement-breakpoint

-- The sweep in lib/otp.ts used to delete on `expires_at < now`, which is ten
-- minutes after issue — so the counter above would be thrown away long before
-- its window closed and the cap would reset every ten minutes. It now sweeps on
-- `created_at`, so this index is what keeps that from being a full table scan.
--
-- The CODE is still dead at `expires_at`: `verifyOtp` has that in its DELETE
-- predicate, so a row surviving longer is a spent counter, not a live credential.
-- `idx_otp_expires` stays for migration 0006's nightly EVENT, which still reads it.
CREATE INDEX idx_otp_created ON email_otps (created_at);
