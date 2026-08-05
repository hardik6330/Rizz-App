-- Email + password accounts, layered onto the anonymous install identity.
--
-- Every column is NULLABLE: an install that never signs up keeps working exactly
-- as before. Signup CLAIMS the row the install already owns rather than creating
-- a new one, so credits already spent stay spent — that is the whole point.
--
-- NOTE: `email` is PII. Before this migration the schema held none, which was a
-- deliberate property (see the comment at the top of db/schema.ts). Shipping it
-- means the privacy policy and the Play Data Safety form change too.
ALTER TABLE users
  ADD COLUMN username      VARCHAR(32)       NULL,
  ADD COLUMN email         VARCHAR(255)      NULL,
  -- scrypt$N$r$p$salt$key — see lib/password.ts. 255 leaves room to raise N.
  ADD COLUMN password_hash VARCHAR(255)      NULL,
  -- Consecutive failures; reset on success. 10 => locked_until = now + 15min.
  ADD COLUMN failed_logins SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN locked_until  BIGINT            NULL,
  ADD UNIQUE KEY uq_users_email    (email),
  ADD UNIQUE KEY uq_users_username (username);
