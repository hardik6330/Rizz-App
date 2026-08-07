-- Email verification codes, and the end of "one device, one account".
--
-- ## Why this table exists
--
-- Signup took an email nobody ever checked. That made every account's email a
-- string the user typed once, which is why this product shipped with no password
-- reset: you cannot mail a reset link to an address you have no reason to
-- believe in. A verified address turns the mailbox into a second credential, and
-- that single change is what makes both email verification AND account recovery
-- possible — /login now accepts a mailed code in place of the password.
--
-- ## Shape
--
-- The PK is (email, purpose), NOT a random id. One live code per address per
-- purpose, so a resend REPLACES rather than accumulates — otherwise every send
-- leaves another valid code behind and ten resends mean ten guesses' worth of
-- extra surface. It also makes the resend cooldown a plain read of `created_at`
-- instead of a MAX() over a pile of rows.
--
-- `code_hash` and never the code. This table is one `SELECT *` in a support
-- session away from being read by a human, and a live code is a login. SHA-256
-- rather than scrypt on purpose: the input is six digits, so no work factor
-- makes it uncrackable offline, and the defence that actually holds is
-- `attempts` plus the ten-minute expiry — see lib/otp.ts. Hashing here buys the
-- narrower thing: a dump or a log leak does not hand over usable codes.
--
-- `attempts` is per-code, not per-account: 5 wrong guesses burns the code and
-- the user asks for another. A lockout on the ACCOUNT here would have handed an
-- attacker a way to lock out the recovery path itself.
--
-- No FK to `users`. A signup code is issued for an address that has no row yet —
-- that is the whole point — and a login code must survive whatever happens to
-- the row while it is in flight.
CREATE TABLE email_otps (
  email      VARCHAR(255)    NOT NULL,
  -- 'signup' | 'login'. Separate rows, so a code mailed to prove a NEW address
  -- can never be replayed against /login on an existing account, or vice versa.
  purpose    VARCHAR(16)     NOT NULL,
  -- SHA-256 hex of `<email>:<purpose>:<code>` — bound to the row it was issued
  -- for, so one precomputed table of a million digits does not cover every row.
  code_hash  CHAR(64)        NOT NULL,
  attempts   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at BIGINT          NOT NULL,
  -- Doubles as the resend cooldown clock.
  created_at BIGINT          NOT NULL,
  PRIMARY KEY (email, purpose),
  -- The sweep in lib/otp.ts deletes by this. Unindexed it is a full scan on a
  -- table with a hot INSERT.
  KEY idx_otp_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
