/**
 * The three properties a six-digit code is only safe because of, plus the one
 * that stops the new signup path handing out free credits.
 *
 *   cd backend && node --env-file=.env --import tsx src/lib/otp.selfcheck.ts
 *
 * Not pure, for the same reason as routes/auth.selfcheck.ts: the interesting
 * behaviour IS the SQL. `verifyOtp` is a single DELETE whose predicate carries
 * the expiry and the attempt cap, and mocking the database away leaves nothing
 * to assert. What breaks if this is wrong is that a code is guessable, replayable
 * or immortal — each of which is somebody else's account.
 *
 * Refuses to run against production, and deletes everything it wrote.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db, pool } from '../db/client.ts';
import { env } from '../env.ts';
import { createSecondAccount } from '../routes/auth.ts';
import {
  generateCode,
  hashCode,
  issueOtp,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  verifyOtp,
} from './otp.ts';

if (env.NODE_ENV === 'production') {
  throw new Error('refusing to write synthetic rows to a production database');
}

const EMAIL = `otp-selfcheck-${randomUUID()}@example.test`;
const DEVICE: string = randomUUID();
const firstId: string = randomUUID();
const writtenUsers: string[] = [firstId];

/** Backdate the live row's clocks — cheaper and far more reliable than sleeping. */
async function backdate(by: number): Promise<void> {
  await db.execute(sql`
    UPDATE email_otps
       SET created_at = created_at - ${by}, expires_at = expires_at - ${by}
     WHERE email = ${EMAIL}
  `);
}

async function attemptsOf(): Promise<number | undefined> {
  const rows = await db.execute(sql`
    SELECT attempts FROM email_otps WHERE email = ${EMAIL} AND purpose = 'login' LIMIT 1
  `);
  return (rows as unknown as [Array<{ attempts: number }>])[0]?.[0]?.attempts;
}

try {
  // ── 0. The code itself ─────────────────────────────────────────────────────
  // Leading zeros must survive: dropping them shrinks the space to 900k and
  // makes `parseInt('012345')` a different code than the one that was mailed.
  const codes = Array.from({ length: 400 }, generateCode);
  assert.ok(
    codes.every((c) => /^\d{6}$/.test(c)),
    'every code is exactly six digits, zeros included',
  );
  assert.ok(new Set(codes).size > 350, 'codes are random, not a sequence');
  assert.notEqual(
    hashCode(EMAIL, 'login', '000000'),
    hashCode(EMAIL, 'signup', '000000'),
    'the same digits hash differently per purpose — a signup code cannot be replayed at login',
  );

  // ── 1. Single use ──────────────────────────────────────────────────────────
  const code = await issueOtp(EMAIL, 'login');
  assert.ok(code, 'a first issue is never throttled');
  assert.equal(await verifyOtp(EMAIL, 'login', code), true, 'the right code verifies');
  assert.equal(
    await verifyOtp(EMAIL, 'login', code),
    false,
    'the SAME code is dead the second time — the DELETE consumed it',
  );

  // ── 2. Resend cooldown, and that a resend really replaces ───────────────────
  const first = await issueOtp(EMAIL, 'login');
  assert.ok(first, 'reissued after the row was consumed');
  assert.equal(await issueOtp(EMAIL, 'login'), null, 'an immediate resend is throttled');

  await backdate(RESEND_COOLDOWN_MS + 1_000);
  const second = await issueOtp(EMAIL, 'login');
  assert.ok(second, 'past the cooldown a resend is allowed');
  assert.equal(
    await verifyOtp(EMAIL, 'login', first),
    false,
    'the SUPERSEDED code is dead — resending must not leave two valid codes behind',
  );
  assert.equal(await verifyOtp(EMAIL, 'login', second), true, 'the newest code is the live one');

  // ── 3. Attempt cap ─────────────────────────────────────────────────────────
  const guarded = await issueOtp(EMAIL, 'login');
  assert.ok(guarded, 'issued for the attempt-cap case');
  const wrong = guarded === '000000' ? '111111' : '000000';
  for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
    assert.equal(await verifyOtp(EMAIL, 'login', wrong), false, `wrong guess ${i + 1} rejected`);
  }
  assert.equal(await attemptsOf(), MAX_OTP_ATTEMPTS, 'every wrong guess was counted');
  assert.equal(
    await verifyOtp(EMAIL, 'login', guarded),
    false,
    'past the cap even the CORRECT code is refused — this is what bounds 1e6 to 5 guesses',
  );

  // A fresh code is a clean slate. It has to be, or the cap would be permanent.
  await backdate(RESEND_COOLDOWN_MS + 1_000);
  const reissued = await issueOtp(EMAIL, 'login');
  assert.ok(reissued, 'reissue after the cap');
  assert.equal(await attemptsOf(), 0, 'a new code resets the counter');
  assert.equal(await verifyOtp(EMAIL, 'login', reissued), true, 'and it works');

  // ── 4. Expiry ──────────────────────────────────────────────────────────────
  const stale = await issueOtp(EMAIL, 'login');
  assert.ok(stale, 'issued for the expiry case');
  await backdate(OTP_TTL_MS + 1_000);
  assert.equal(await verifyOtp(EMAIL, 'login', stale), false, 'an expired code is refused');

  // ── 5. The credit carry-over on the second account ─────────────────────────
  /*
   * The property that replaced "one device, one account". Dropping that rule
   * without this line means: sign up, spend three analyses, sign up again with
   * another address, three more — for ever, without even a reinstall.
   */
  const now = Date.now();
  await db.execute(sql`
    INSERT INTO users (id, install_id, platform, email, analysis_count, created_at, updated_at)
    VALUES (${firstId}, ${DEVICE}, 'android', ${`first-${EMAIL}`}, 3, ${now}, ${now})
  `);
  const secondId = await createSecondAccount(
    firstId,
    DEVICE,
    `u${randomUUID().slice(0, 8)}`,
    `second-${EMAIL}`,
    'scrypt$dummy',
    now,
  );
  writtenUsers.push(secondId);

  const rows = await db.execute(sql`
    SELECT id, install_id, analysis_count, is_pro FROM users WHERE id IN (${firstId}, ${secondId})
  `);
  const byId = new Map(
    (rows as unknown as [Array<{ id: string; install_id: string; analysis_count: number; is_pro: number }>])[0].map(
      (r) => [r.id, r],
    ),
  );
  assert.equal(
    byId.get(secondId)?.analysis_count,
    3,
    'the new account inherits the DEVICE spend — free analyses are per device, not per email',
  );
  assert.equal(byId.get(secondId)?.install_id, DEVICE, 'and it now owns the install');
  assert.notEqual(
    byId.get(firstId)?.install_id,
    DEVICE,
    'while the first account was re-homed rather than deleted — it still has an email to log in with',
  );
  assert.equal(byId.get(secondId)?.is_pro, 0, 'a subscription is NEVER copied to the new row');

  console.log('otp.selfcheck: ok');
} finally {
  await db.execute(sql`DELETE FROM email_otps WHERE email = ${EMAIL}`);
  await db.execute(sql`DELETE FROM users WHERE id IN (${sql.join(writtenUsers.map((id) => sql`${id}`), sql`, `)})`);
  await pool.end();
}
