-- Per-user token revocation.
--
-- Access tokens last 30 days and `logOut()` only deleted the copy in MMKV, so a
-- token captured from a device backup, a shared phone or a proxy stayed valid
-- for its full life with no way to kill it. The only revocation that existed was
-- `banned_at`, which also locks out the legitimate owner.
--
-- The epoch is baked into the JWT and compared against this column on every
-- request. `requireAuth` already reads the row, so the check is free — see the
-- note there about what that per-request lookup buys.
--
-- INT UNSIGNED, not SMALLINT: this increments on every sign-out and every
-- password change, and a counter that silently wraps back onto a live token is
-- a revocation that un-revokes itself.
ALTER TABLE users
  ADD COLUMN token_epoch INT UNSIGNED NOT NULL DEFAULT 0;
