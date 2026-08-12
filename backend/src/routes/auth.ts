import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.ts';
import { isDisposableEmail } from '../lib/disposable.ts';
import { proNow } from '../lib/entitlement.ts';
import { ApiError, Errors } from '../lib/errors.ts';
import { signAccess } from '../lib/jwt.ts';
import { FREE_ANALYSIS_LIMIT } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';
import { sendOtpEmail } from '../lib/mailer.ts';
import { sweeper } from '../lib/sweep.ts';
import { issueOtp, type OtpPurpose, verifyOtp } from '../lib/otp.ts';
// `dummyHash` is gone from here: it existed only to make a missing email take as
// long as a wrong password, and /login now names that case outright.
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { requireAccount, requireAuth } from '../middleware/auth.ts';

/**
 * Identity, in two layers.
 *
 * `/device` is the anonymous install identity the app has always had: no email,
 * no password, no signup screen, because asking for an account before the first
 * analysis destroys activation in a product people are already self-conscious
 * about using.
 *
 * `/signup` and `/login` layer an account on top of that, and the ordering is
 * the point: signup CLAIMS the row the install already owns instead of creating
 * a new one, so credits already spent stay spent, and a reinstall that logs in
 * lands back on the same row rather than a fresh set of free analyses.
 *
 * Email addresses are VERIFIED. `/otp` mails a six-digit code, `/signup` will
 * not write an email without one, and `/login` accepts a code in place of the
 * password — which is this product's account recovery. There is still no
 * password RESET (no reset link, no "new password" screen): owning the mailbox
 * gets you back into the account, and you can keep using the password you have.
 *
 * A verified address is also what let "one device, one account" go. Signup used
 * to reject any install that already had an account, because an unverified email
 * cost nothing to invent and the install row was the only thing tying a signup
 * to something real. Now the mailbox is, so a device can host as many accounts
 * as it has addresses to prove — see `/signup`.
 *
 * PHASE 1 CAVEAT: a JWT alone does not stop someone extracting the endpoint and
 * minting install_ids. Play Integrity / App Attest gating token issuance is
 * Phase 5 and is what actually makes the Gemini key safe. Until then the real
 * protection is the per-day cap in the credit gate plus the global kill switch.
 */
const Body = z.object({
  /**
   * Absent on first launch — the server mints it and returns it, and the client
   * persists it forever.
   *
   * Deliberately not generated client-side: React Native has no `crypto` global,
   * so the app would need `expo-crypto` (a native module, therefore a rebuild
   * rather than an OTA) or `Math.random`, which is not unguessable — and this id
   * IS the credential that owns a user's credits.
   */
  install_id: z.string().uuid().optional(),
  platform: z.enum(['ios', 'android']),
  app_version: z.string().max(24).optional(),
});

export const auth = new Hono();

interface UserRow {
  id: string;
  is_pro: number;
  analysis_count: number;
  banned_at: number | null;
  /** Null until /signup. The client shows it, and uses it as "am I signed in?". */
  username: string | null;
  /** Signed into the token as `ep`; see lib/jwt.ts. */
  token_epoch: number;
}

/** One row by primary key, or undefined. */
async function userById(id: string): Promise<UserRow | undefined> {
  const rows = await db.execute(sql`
    SELECT id, ${proNow()} AS is_pro, analysis_count, banned_at, username, token_epoch
      FROM users WHERE id = ${id} LIMIT 1
  `);
  return (rows as unknown as [UserRow[]])[0]?.[0];
}

/**
 * The response body `/device`, `/signup` and `/login` all return.
 *
 * One shape, because the client persists the token and pushes `user` straight
 * into the store on every one of them — three hand-rolled bodies is how
 * `analysis_count` goes missing on one path and `useOutOfCredits` starts
 * evaluating `undefined >= 3`. See the note on `creditsEnvelope`.
 */
/**
 * @param opts.device Mint a DEVICE session — see the `dev` claim in lib/jwt.ts.
 *   Set only by `/device`, which authenticates an install id and never a person.
 */
async function sessionFor(
  user: UserRow,
  opts: { installId?: string; device?: boolean } = {},
) {
  const isPro = user.is_pro === 1;
  const { installId, device = false } = opts;
  const { token, expiresIn } = await signAccess({
    sub: user.id,
    pro: isPro,
    ep: user.token_epoch,
    dev: device,
  });
  return {
    access_token: token,
    expires_in: expiresIn,
    ...(installId ? { install_id: installId } : {}),
    user: {
      /*
       * The client passes this to `Purchases.logIn()` so RevenueCat's App User
       * ID IS our user id. Without it the SDK invents an anonymous
       * `$RCAnonymousID:` that dies with the install, and a subscriber who
       * reinstalls cannot restore. Safe to expose: it is an opaque UUID the
       * bearer already holds a token for, and every request is authorised by
       * that token, never by this.
       */
      id: user.id,
      /*
       * null = anonymous install. The client gates its account UI on this — and
       * that is why a DEVICE session must always report null, whatever is on the
       * row.
       *
       * The install id survives sign-out on purpose, and signup claimed the
       * install's row, so `/device` resolves straight to the account. It used to
       * answer with the username attached, and the client's `persistSession`
       * read that as "signed in" — so the first resume after signing out put the
       * user back into their account with no password, having also walked around
       * the `token_epoch` bump that `/logout` had just made. A device proves
       * possession of an install id; it cannot vouch for a person.
       */
      username: device ? null : user.username,
      is_pro: isPro,
      analysis_count: user.analysis_count,
      credits_remaining: isPro ? null : Math.max(0, FREE_ANALYSIS_LIMIT - user.analysis_count),
      limits: { free_analysis: FREE_ANALYSIS_LIMIT },
    },
  };
}

/**
 * Delete anonymous rows that never did anything.
 *
 * Every cleared install mints one, and only a login reclaims it — the rest are
 * abandoned and unreachable for ever: no email to log in with, no id anyone
 * still holds. The predicate is deliberately narrow. `analysis_count = 0` means
 * deleting one grants nothing (a re-appearing install starts where it was), and
 * email / rc_app_user_id / is_pro keep every row anybody paid for or can sign
 * into.
 *
 * ponytail: no index on updated_at, so this is a bounded scan every 6h. Add
 * ix_users_gc if the table ever gets big enough to feel it.
 */

/**
 * How long an untouched anonymous row is kept. Was 30 days.
 *
 * `/device` bumps `updated_at` on every cold launch, so this is time since the
 * install last opened the app — not since it was created. Ten days is a phone
 * left in a drawer over a long holiday; the row it deletes has spent nothing
 * (`analysis_count = 0` is in the predicate), so a reappearing install with the
 * same MMKV `install_id` is re-minted at exactly the state it left, and one that
 * lost its MMKV was getting a new row either way.
 *
 * Shortening it costs nothing except the ability to look at an old abandoned
 * install in the table. Anything the row could still be worth — an email, a
 * subscription, a spent credit — is a separate clause above and is unaffected.
 */
const ANON_TTL_MS = 10 * 24 * 60 * 60 * 1000;

export const anonymousGc = (now: number) => sql`
  DELETE FROM users
   WHERE email IS NULL
     AND rc_app_user_id IS NULL
     AND is_pro = 0
     AND analysis_count = 0
     AND updated_at < ${now - ANON_TTL_MS}
   LIMIT 500
`;

const sweepAnonymous = sweeper(6 * 60 * 60 * 1000, anonymousGc);

auth.post('/device', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.badRequest('install_id and platform are required');
  const { platform, app_version } = parsed.data;
  const install_id = parsed.data.install_id ?? randomUUID();

  const now = Date.now();
  const id = randomUUID();
  sweepAnonymous(now);

  // Upsert on install_id. The UNIQUE key makes concurrent first-launch races a
  // no-op rather than a duplicate user with a fresh set of free credits.
  await db.execute(sql`
    INSERT INTO users (id, install_id, platform, app_version, created_at, updated_at)
    VALUES (${id}, ${install_id}, ${platform}, ${app_version ?? null}, ${now}, ${now})
    ON DUPLICATE KEY UPDATE app_version = VALUES(app_version), updated_at = ${now}
  `);

  const rows = await db.execute(sql`
    SELECT id, ${proNow()} AS is_pro, analysis_count, banned_at, username, token_epoch
      FROM users WHERE install_id = ${install_id} LIMIT 1
  `);
  const user = (rows as unknown as [UserRow[]])[0]?.[0];
  if (!user) throw Errors.badRequest('could not create device');
  if (user.banned_at) throw Errors.banned();

  log.info('auth.device', { platform, isNew: user.id === id });

  // install_id echoed back so a first-launch client can persist the one the
  // server minted. `device: true` — this endpoint authenticates an install, not
  // a person, and the session it hands out says so.
  return c.json(await sessionFor(user, { installId: install_id, device: true }));
});

// ── POST /v1/auth/otp ────────────────────────────────────────────────────────

/**
 * One definition of an email, used by all three endpoints that take one.
 *
 * The `.transform` is load-bearing rather than tidiness: `users.email` is UNIQUE
 * and the OTP table is keyed on the address, so `Sam@x.com` and `sam@x.com` have
 * to normalise to the same string or a code mailed by one is invisible to the
 * other and the same person can hold two accounts.
 */
const emailField = z
  .string()
  .email('That email does not look right')
  .max(255)
  .transform((e) => e.trim().toLowerCase());

/**
 * String, never a number — `012345` is a valid code and `parseInt` is not.
 * See `generateCode()` in lib/otp.ts.
 */
const codeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your email');

/**
 * The username rules, shared by `/otp` and `/signup`.
 *
 * One definition because `/otp` now pre-checks the name the user typed: two
 * copies would drift, and the failure would be a name accepted at the pre-check
 * and rejected after the code — which is the exact experience this pre-check
 * exists to remove.
 */
const usernameField = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be 32 characters or fewer')
  .regex(/^[a-z0-9_]+$/i, 'Username can use letters, numbers and _ only');

const OtpBody = z.object({
  email: emailField,
  purpose: z.enum(['signup', 'login']),
  /**
   * Signup only, and optional so an older client still works — it just gets the
   * pre-check it always got, which is none.
   */
  username: usernameField.optional(),
});

/**
 * Mail a code, or say why one is not coming.
 *
 * **This used to always answer `{ ok: true }`.** The uniform answer stopped this
 * being an account-existence oracle, and it was the right call on paper. In the
 * product it meant the single commonest signup mistake — using the address you
 * already have an account with — produced a screen that said "check your email"
 * and a code that was never sent. The user has no way to discover that, and no
 * wording covers it: "if that address has an account" reads as reassurance, not
 * as a warning that nothing happened.
 *
 * So the two dead-end cases now fail loudly, and the client uses the CODE to
 * move the user to the other tab with what they typed still in the field. See
 * `Errors.emailTaken` for what still bounds enumeration.
 *
 * The cooldown inside `issueOtp` is still silent — a resend the server swallowed
 * and one it honoured look identical, and the user has a live code either way.
 *
 * Unauthenticated on purpose. The recovery path has to work on a phone that has
 * been signed out, wiped, or is not the phone the account was made on — and
 * requiring a device token would only mean one extra call to `/device` for
 * anybody abusing it. The real limits are the IP bucket in app.ts and the
 * per-address cooldown.
 */
auth.post('/otp', async (c) => {
  const parsed = OtpBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Check your email');
  const { email, purpose, username } = parsed.data;

  /*
   * Throwaway inboxes, refused before anything is looked up or mailed.
   *
   * Signup only, and that asymmetry is deliberate: accounts made before this
   * rule existed still have to be able to log in and — more to the point — to
   * recover with a mailed code. Refusing the login purpose would strand them
   * with no way back in and no way to change the address.
   *
   * This is the only gate needed: `/signup` will not write a row without a code
   * that only this endpoint issues, so an address refused here can never reach
   * it.
   */
  if (purpose === 'signup' && isDisposableEmail(email)) throw Errors.disposableEmail();

  const rows = await db.execute(sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`);
  const taken = ((rows as unknown as [Array<{ id: string }>])[0]?.[0] ?? null) != null;

  // Nothing to verify: signing up into an address that is already an account, or
  // recovering one that does not exist. Named, not swallowed — see above.
  if (purpose === 'signup' && taken) throw Errors.emailTaken();
  if (purpose === 'login' && !taken) throw Errors.noAccount();

  /*
   * The username, checked BEFORE a code is mailed.
   *
   * The email clash above was already caught here, but a username clash was not
   * — it surfaced from `ER_DUP_ENTRY` inside `/signup`, which only runs after
   * the user has waited for a mail, switched apps to read it, and typed six
   * digits. Being told "that username is taken" at that point means going back
   * to a form whose code is now burnt, so the whole round trip repeats for a
   * field they could have been told about immediately.
   *
   * Plain `=` rather than a LOWER() call, deliberately: the column's unique
   * index `uq_users_username` compares under the table's case-insensitive
   * collation, and the pre-check has to agree with the index or it will pass a
   * name that the INSERT then rejects.
   *
   * Race is still possible — a name can be claimed between here and `/signup` —
   * so the `ER_DUP_ENTRY` handler there stays as the backstop. This makes the
   * common case immediate; it does not make the guarantee.
   *
   * ⚠️ A rejection here still costs an `/otp` token, because the bucket in
   * app.ts runs as middleware and cannot know the handler was about to refuse.
   * That bucket is the tightest in the service (4, refilling at one per ~50s)
   * because a call normally means a paid email — and this is the one rejection
   * a user RETRIES, since they fix the name and try again. Email clashes send
   * them to the login tab instead, so they never loop. Four attempts inside a
   * minute is more names than anyone tries, but if this endpoint ever needs to
   * answer "is this name free" as the user types, it must move to its own route
   * under the looser `/v1/auth/*` bucket rather than being called per keystroke
   * here.
   */
  if (purpose === 'signup' && username) {
    const found = await db.execute(sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`);
    if (((found as unknown as [Array<{ id: string }>])[0]?.[0] ?? null) != null) {
      throw Errors.usernameTaken();
    }
  }

  const code = await issueOtp(email, purpose as OtpPurpose);
  // null = cooldown; a code is already in flight, so this really is a no-op.
  if (code != null) await sendOtpEmail(email, code, purpose as OtpPurpose);

  log.info('auth.otp.sent', { purpose, throttled: code == null });
  return c.json({ ok: true });
});

// ── POST /v1/auth/signup ─────────────────────────────────────────────────────

/**
 * Username is public and shown back to the user; email and password are not.
 *
 * Minimum length over composition rules on purpose — NIST 800-63B dropped the
 * "one uppercase, one symbol" advice because it pushes people toward `Passw0rd!`
 * and a password manager toward nothing. 10 characters, anything in them.
 */
const SignupBody = z.object({
  username: usernameField,
  email: emailField,
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128, 'Password must be 128 characters or fewer'),
  /** From the email `/otp` just sent. This is what makes the address real. */
  code: codeField,
});

/**
 * Attach an account to the install that is already calling us.
 *
 * `requireAuth`, not anonymous: the caller must already hold a device token, and
 * the account is written onto THAT row. Creating a fresh row here would hand out
 * three more free analyses for the price of a signup form, which is the exact
 * hole an account is supposed to close.
 *
 * The email is verified before anything is written: `code` has to be the one
 * `/otp` mailed to that exact address, and `verifyOtp` burns it. So an account
 * cannot be created against an address the user does not control, and a typo
 * fails at the code step — where it is still fixable — rather than becoming an
 * account with no way back in.
 *
 * **"One device, one account" is gone.** This used to require `email IS NULL` on
 * the row and reject the whole request otherwise, on the reasoning that an
 * unverified email cost nothing to invent so the install had to be the scarce
 * thing. A verified address is now the scarce thing, so the restriction has no
 * job left — and it was costing real users: a shared phone, a second account, or
 * anyone who signed out and wanted to start fresh hit a hard wall. Two paths
 * now, and which one runs turns on whether this device's row is already spoken
 * for; see the branch below.
 *
 * Verification is still NOT the anti-abuse story on its own — disposable
 * addresses exist. The IP-scoped grant cap and the global spend ceiling remain
 * what bound farming, along with the credit carry-over noted below.
 */
auth.post('/signup', requireAuth, async (c) => {
  const { sub } = c.get('user');
  const parsed = SignupBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Check your details');
  const { username, email, password, code } = parsed.data;

  /*
   * Before the hash and before any write. `hashPassword` is ~100ms of scrypt and
   * a wrong code has no business paying for it, but the ordering matters more
   * than the cost: nothing about the account may be written on the strength of
   * an address that has not been proven.
   */
  if (!(await verifyOtp(email, 'signup', code))) throw Errors.badRequest(BAD_CODE);

  const now = Date.now();
  const rows = await db.execute(sql`
    SELECT install_id, email FROM users WHERE id = ${sub} LIMIT 1
  `);
  const caller = (rows as unknown as [Array<{ install_id: string; email: string | null }>])[0]?.[0];
  if (!caller) throw Errors.unauthorized();

  const hash = await hashPassword(password);
  // Which row the session is issued for: the device's own on the claim path, a
  // brand new one on the second-account path.
  let accountId = sub;

  try {
    if (caller.email == null) {
      /*
       * The ordinary path, unchanged: the install is anonymous, so CLAIM its row
       * rather than making a new one. This is what stops a reinstall buying three
       * more free analyses — the credits already spent stay spent because they
       * are counted on the very row that is becoming the account.
       */
      const [result] = await db.execute(sql`
        UPDATE users
           SET username      = ${username},
               email         = ${email},
               password_hash = ${hash},
               updated_at    = ${now}
         WHERE id = ${sub} AND email IS NULL
      `);
      // Still guarded. Two signups racing on one install must not have the second
      // overwrite the first's credentials; the loser falls through to a fresh row.
      if ((result as { affectedRows: number }).affectedRows === 0) {
        accountId = await createSecondAccount(sub, caller.install_id, username, email, hash, now);
      }
    } else {
      accountId = await createSecondAccount(sub, caller.install_id, username, email, hash, now);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      // Both clashes are named, and both are now only reachable if somebody
      // claimed the address or the name between `/otp` and here — `/otp` refuses
      // both up front. So this is the race backstop rather than the usual path,
      // and it answers with the same codes the pre-check does: a client that
      // knows how to highlight the username field must not have to learn a
      // second way of being told the same thing.
      throw String((err as Error).message).includes('uq_users_username')
        ? Errors.usernameTaken()
        : Errors.emailTaken();
    }
    throw err;
  }

  const user = await userById(accountId);
  if (!user) throw Errors.unauthorized();

  // Never the email, never the username — same rule as logger.ts.
  log.info('auth.signup', { secondAccount: accountId !== sub });
  return c.json(await sessionFor(user, { installId: caller.install_id }));
});

/**
 * A second (or third) account on a device that already hosts one.
 *
 * The claim-in-place path cannot be used here: the caller's row belongs to
 * somebody's account, and writing a new username/email/password over it would
 * destroy that account rather than create one.
 *
 * **The credit carry-over is not a detail.** The new row inherits
 * `analysis_count` from whoever currently owns the install. Without it, dropping
 * the one-account rule would have reopened the exact hole accounts were built to
 * close, and made it cheaper than before: sign up, spend three free analyses,
 * sign up again with another address, repeat — no reinstall required. Free
 * analyses are a property of the DEVICE and they stay that way.
 *
 * ponytail: the honest cost is that a genuine second person on a shared phone
 * gets no free trial. That is the right side to err on for a paid product, and
 * the fix if it ever bites is a per-device grant with a long window rather than
 * a per-account one — a bigger change than this line.
 *
 * `is_pro` and `entitlement_expires_at` are deliberately NOT copied: they are a
 * subscription, and cloning one hands out a paid entitlement for free. Nor is
 * `rc_app_user_id`, which is UNIQUE and belongs to exactly one row.
 *
 * The row is inserted holding a THROWAWAY install id, then `claimInstall` moves
 * the real one across. `install_id` is UNIQUE and NOT NULL, so it cannot be
 * inserted directly (duplicate) and cannot be left out (null) — claimInstall is
 * already the routine that takes an id off its current holder safely, and this
 * is the same problem /login solves.
 */
export async function createSecondAccount(
  callerId: string,
  installId: string,
  username: string,
  email: string,
  passwordHash: string,
  now: number,
): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO users (id, install_id, platform, app_version, username, email, password_hash,
                       analysis_count, created_at, updated_at)
    SELECT ${id}, ${randomUUID()}, platform, app_version, ${username}, ${email}, ${passwordHash},
           analysis_count, ${now}, ${now}
      FROM users WHERE id = ${callerId}
  `);
  await claimInstall(id, installId, now);
  return id;
}

// ── POST /v1/auth/login ──────────────────────────────────────────────────────

/** One message for a code that is wrong, expired, already spent, or never issued. */
const BAD_CODE = 'That code is wrong or has expired — request a new one';

/**
 * Two ways in, and exactly one of them per request.
 *
 * `password` is the ordinary path. `code` is the recovery path: prove you own
 * the mailbox and the password is not needed. That IS the password reset this
 * product never had — without the part where a reset link lets a stolen inbox
 * lock the real owner out by CHANGING the password. Here the password is
 * untouched; the mailbox is simply a second way to prove it is you.
 */
const LoginBody = z
  .object({
    email: emailField,
    password: z.string().min(1).max(128).optional(),
    /** From `/otp` with `purpose: 'login'`. Mutually exclusive with `password`. */
    code: codeField.optional(),
    /**
     * The install doing the logging in. OPTIONAL, so a client built before this
     * shipped still logs in — it just stays split (see `claimInstall`).
     */
    install_id: z.string().uuid().optional(),
  })
  // XOR, not "at least one". Accepting both would mean a request with a valid
  // code and a junk password, and then the answer depends on which branch the
  // handler happens to check first — an ambiguity in an auth decision.
  .refine((v) => (v.password == null) !== (v.code == null), {
    message: 'Enter your password, or the code we emailed you',
  });

/** Consecutive failures before the account is parked for LOCKOUT_MS. */
export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MS = 15 * 60_000;

/**
 * The failure counter after one more wrong guess.
 *
 * **The bug this fixes.** `failed_logins` was only ever reset on a SUCCESSFUL
 * login, so it was a lifetime counter rather than the consecutive one the schema
 * comment claims. Once it passed 10 the account sat permanently one wrong guess
 * away from another 15-minute lock:
 *
 *     t=0    10 wrong guesses → failed=10, locked_until = now + 15min
 *     t=15m  lock expires, failed_logins is STILL 10
 *     t=15m  1 wrong guess    → failed=11 ≥ 10 → locked another 15 min
 *            ↻ 96 attempts a day holds it shut for ever
 *
 * The IP bucket does not stop that — it is 8 tokens refilling at 0.05/s, and the
 * attack needs one attempt per fifteen minutes. So anyone who knew a user's
 * email could deny them their account indefinitely, and **there is no password
 * reset**, which means no recovery that does not involve editing the database by
 * hand. A lockout added to protect an unrecoverable account was the surest way
 * to make one.
 *
 * An expired lock is a clean slate: the punishment has been served.
 *
 * Pure so it can be tested without a database — see auth.selfcheck.ts.
 */
export function nextFailureState(
  row: { failed_logins: number; locked_until: number | null },
  now: number,
): { failed: number; lockedUntil: number | null } {
  const lockExpired = row.locked_until != null && row.locked_until <= now;
  const failed = (lockExpired ? 0 : row.failed_logins) + 1;
  return { failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? now + LOCKOUT_MS : null };
}

interface LoginRow extends UserRow {
  password_hash: string | null;
  failed_logins: number;
  locked_until: number | null;
}

/**
 * Point this install at the row that just authenticated.
 *
 * **The bug this fixes.** `/signup` claims the install's row; `/login` used not
 * to touch `install_id` at all. So after logging in, the device held a token for
 * row B while MMKV still addressed row A. That is invisible for up to 30 days —
 * and then the token expires, `accessToken()` falls back to `/device` with
 * install_id A, the server answers with `username: null`, and the app silently
 * signs the user out and resets their credits to a row they have never used.
 * Every login also stranded row A for ever, which is where the duplicate
 * anonymous rows come from.
 *
 * Three statements, in this order, because `uq_users_install` is UNIQUE and
 * `install_id` is NOT NULL — the id has to be taken off whoever holds it before
 * it can be given to anybody else:
 *
 *   1. The holder is anonymous AND owns no subscription → DELETE it. Once the
 *      device points elsewhere nothing can ever reach that row again: it has no
 *      email to log in with, so keeping it would only park its free credits
 *      somewhere unreachable. `email IS NULL` is load-bearing — without it a
 *      shared device deletes a real account.
 *
 *      `rc_app_user_id IS NULL` is load-bearing for a subtler case: someone who
 *      SUBSCRIBED before signing up has an entitlement on a row with no email.
 *      Deleting it when a second person logs in on that phone left RevenueCat
 *      billing a card for a user that no longer exists — every later renewal
 *      landing as `rc.webhook.unknown_user`, entitling nobody, refundable by
 *      nobody. Such a row falls through to step 2 and is re-homed instead, so
 *      the webhook can still find it by `rc_app_user_id`.
 *   2. The holder is a real account (two people share one phone) → give it a
 *      FRESH install_id rather than deleting it. It stays reachable by email and
 *      password with its credits intact; it just no longer owns this device.
 *      Skipping this is not cosmetic, it is an ER_DUP_ENTRY 500 on step 3.
 *   3. Take the id.
 *
 * Transactional because a crash between 1 and 3 leaves the install owned by
 * nobody, and the next `/device` mints a third row.
 */
export async function claimInstall(userId: string, installId: string, now: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM users
       WHERE install_id = ${installId}
         AND id <> ${userId}
         AND email IS NULL
         AND rc_app_user_id IS NULL
    `);
    await tx.execute(sql`
      UPDATE users SET install_id = ${randomUUID()}, updated_at = ${now}
       WHERE install_id = ${installId} AND id <> ${userId}
    `);
    await tx.execute(sql`
      UPDATE users
         SET install_id    = ${installId},
             failed_logins = 0,
             locked_until  = NULL,
             updated_at    = ${now}
       WHERE id = ${userId}
    `);
  });
}

/**
 * Email + password → a session on the ORIGINAL user row.
 *
 * This is the endpoint that makes an account worth having: a reinstall gets a
 * new install_id and a new anonymous row, then logs in and is handed back the
 * row it started with — spent credits, Pro state and all. `claimInstall` above
 * is what finishes that handover; without it the device is left addressing the
 * throwaway row instead of the one it was just handed.
 *
 * Takes EITHER a password or a mailed code — see `LoginBody`. The lockout and
 * the token bucket in app.ts still guard the password branch; the code branch is
 * bounded by the code's own attempt cap instead, and skips the lockout on
 * purpose. The reasoning for that is in the branch itself and is the sharpest
 * decision in this file.
 */
auth.post('/login', async (c) => {
  const parsed = LoginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Email and password are required');
  }
  const { email, password, code } = parsed.data;
  const now = Date.now();

  const rows = await db.execute(sql`
    SELECT id, password_hash, failed_logins, locked_until, banned_at, token_epoch,
           ${proNow()} AS is_pro, analysis_count, username
      FROM users WHERE email = ${email} LIMIT 1
  `);
  const row = (rows as unknown as [LoginRow[]])[0]?.[0];

  // Before either branch. A ban outranks any proof of identity.
  if (row?.banned_at) throw Errors.banned();

  /*
   * No such address — named, and named BEFORE either branch.
   *
   * This used to be folded into the wrong-password answer so the two were
   * indistinguishable, with a dummy scrypt hash below to make them take the same
   * time as well. `/otp` gives the same fact away now, so hiding it here only
   * cost the user: "Invalid email or password" on a typo'd address sends people
   * hunting for a password that was never the problem.
   *
   * It also removes the dummy hash: ~100ms of scrypt whose only job was closing
   * a timing channel that is no longer a channel.
   */
  if (!row) throw Errors.noAccount();

  if (code != null) {
    /*
     * ── Recovery path ────────────────────────────────────────────────────────
     *
     * **No lockout check here, deliberately.** `locked_until` exists to stop
     * password guessing, and this branch does not guess a password — it proves
     * possession of the mailbox the account was verified against. Applying the
     * lock to it as well would mean the documented recovery route is shut off by
     * precisely the attack it recovers from: ten wrong guesses against a
     * stranger's email and the owner is locked out of BOTH ways in for fifteen
     * minutes at a time, indefinitely. The code's own five-attempt cap is this
     * branch's limiter, and `/otp`'s cooldown bounds how fast codes appear.
     *
     * The row was checked above, so this only ever answers a code question: the
     * code is wrong, expired, already spent, or was never issued. All four get
     * one message — telling them apart helps nobody type it correctly.
     */
    if (!(await verifyOtp(email, 'login', code))) throw Errors.badRequest(BAD_CODE);
    log.info('auth.login.code');
  } else {
    // Its own code, not the generic 429: a rate limit reads as "the app is busy",
    // and the message has to carry the way out (the emailed code) as well as the
    // wait, because this is the state a user who forgot their password lands in.
    if (row.locked_until != null && row.locked_until > now) throw Errors.accountLocked();

    if (!(await verifyPassword(password!, row.password_hash))) {
      const { failed, lockedUntil } = nextFailureState(row, now);
      await db.execute(sql`
        UPDATE users
           SET failed_logins = ${failed},
               locked_until  = ${lockedUntil}
         WHERE id = ${row.id}
      `);
      if (lockedUntil != null) log.warn('auth.locked', { failed });
      // Locked by THIS attempt: say so now rather than letting the user discover
      // it on the next try, when the message would look like it changed at random.
      throw lockedUntil != null ? Errors.accountLocked() : Errors.wrongPassword();
    }
  }

  /*
   * Always claim, minting an id when the client has none — a cleared install
   * that reaches this screen before `/device` ran has nothing in MMKV to send.
   * Logging in without one left the device holding a token for this row and no
   * install id at all, so the next 401 fell back to `/device`, minted a fresh
   * anonymous row, and silently demoted the user to it. That is where the blank
   * rows come from. The claim SUBSUMES the failed-login reset — step 3.
   */
  const install = parsed.data.install_id ?? randomUUID();
  await claimInstall(row.id, install, now);

  log.info('auth.login', { claimedInstall: parsed.data.install_id != null, viaCode: code != null });
  // Echoed so the client can persist it: on the reinstall path this may be the
  // first time this device learns which install id it now owns.
  return c.json(await sessionFor(row, { installId: install }));
});

// ── POST /v1/auth/logout ─────────────────────────────────────────────────────

/**
 * Kill every token this account holds.
 *
 * Sign-out used to be `kv.remove(TOKEN_KEY)` and nothing else — the token stayed
 * valid for the rest of its 30 days on any device, backup or proxy log that had
 * a copy, and the only way to stop it was to ban the user. Bumping the epoch
 * invalidates all of them at the next request, at the cost of nothing:
 * `requireAuth` was already reading this row.
 *
 * Signs out EVERY device, not just this one, and that is the intended shape for
 * a product with no session list and no "sign out other devices" screen. The one
 * reason a user reaches for sign-out on a phone they no longer trust is the one
 * this has to cover.
 *
 * The client calls it fire-and-forget and clears its own state regardless — an
 * offline sign-out must still sign you out locally, and the server-side kill
 * lands on the next successful call.
 */
auth.post('/logout', requireAuth, requireAccount, async (c) => {
  const { sub } = c.get('user');
  await db.execute(sql`
    UPDATE users SET token_epoch = token_epoch + 1, updated_at = ${Date.now()}
     WHERE id = ${sub}
  `);
  log.info('auth.logout');
  return c.json({ ok: true });
});
