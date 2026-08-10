import { bigint, char, date, double, index, int, json, mediumtext, mysqlEnum, mysqlTable, primaryKey, smallint, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

/**
 * Three tables. See docs/README.md §5 for what is deliberately absent
 * and the condition that earns each deferred table.
 *
 * NEVER add: images, transcripts, replies, reports, or saved items.
 *
 * PII is now a NARROW, deliberate exception rather than a flat prohibition:
 * `email` and `username` on `users`, and nothing else, added with accounts in
 * migration 0001. That was a real trade — this schema held zero PII before it —
 * so the rule is now "the two account columns, and never a third". Anything
 * derived from what a user analysed still has nowhere to live here.
 */

/** One row per install; an account may later be attached to it. */
export const users = mysqlTable(
  'users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    installId: char('install_id', { length: 36 }).notNull(),
    rcAppUserId: varchar('rc_app_user_id', { length: 128 }),
    platform: mysqlEnum('platform', ['ios', 'android']).notNull(),
    appVersion: varchar('app_version', { length: 24 }),

    /*
     * Account, attached by /v1/auth/signup. All nullable: an install that never
     * signs up keeps working exactly as it did. Signup claims THIS row rather
     * than creating one, which is what stops a reinstall buying three more free
     * analyses.
     *
     * `email` is VERIFIED as of migration 0005: /signup will not write one
     * without a code mailed to it and handed back. There is still no password
     * column to reset — recovery is a mailed code on /login instead.
     */
    username: varchar('username', { length: 32 }),
    email: varchar('email', { length: 255 }),
    /** scrypt$N$r$p$salt$key — see lib/password.ts. Never logged, never returned. */
    passwordHash: varchar('password_hash', { length: 255 }),
    failedLogins: smallint('failed_logins', { unsigned: true }).notNull().default(0),
    lockedUntil: bigint('locked_until', { mode: 'number' }),

    /**
     * Bumped to kill every token this user holds. Baked into the JWT as `ep` and
     * compared on every request — see lib/jwt.ts and middleware/auth.ts.
     *
     * Sign-out used to be a client-side MMKV delete and nothing else, so a
     * 30-day token outlived it by 30 days. `banned_at` was the only revocation
     * that existed, and it locks the owner out too.
     */
    tokenEpoch: int('token_epoch', { unsigned: true }).notNull().default(0),

    isPro: tinyint('is_pro').notNull().default(0),
    entitlementExpiresAt: bigint('entitlement_expires_at', { mode: 'number' }),

    // Mirrors src/state/limits.ts. Same rule, second caller — never a fork.
    analysisCount: int('analysis_count', { unsigned: true }).notNull().default(0),
    dailyCallCount: int('daily_call_count', { unsigned: true }).notNull().default(0),
    dailyCallDate: date('daily_call_date', { mode: 'string' }),

    bannedAt: bigint('banned_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    uqInstall: uniqueIndex('uq_users_install').on(t.installId),
    uqRc: uniqueIndex('uq_users_rc').on(t.rcAppUserId),
    // MySQL allows many NULLs in a UNIQUE key, so anonymous rows do not collide.
    uqEmail: uniqueIndex('uq_users_email').on(t.email),
    uqUsername: uniqueIndex('uq_users_username').on(t.username),
  }),
);

/** Generated ONCE per day, globally. The PK doubles as the cron idempotency guard. */
export const dailyFeed = mysqlTable(
  'daily_feed',
  {
    feedDate: date('feed_date', { mode: 'string' }).notNull(),
    version: smallint('version', { unsigned: true }).notNull(),
    itemsJson: json('items_json').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  /*
   * The composite PK is NOT decoration — `generateFeed()` relies on
   * `INSERT IGNORE` to collapse a race between two instances that both missed
   * the cache, and INSERT IGNORE without a unique key ignores nothing. Every
   * request would then generate and insert its own copy of the day's batch.
   *
   * It was missing here while `0000_init.sql` declared it, so the running
   * database was correct and the model was not. Invisible, because every query
   * in this service is raw SQL — until someone ran `db:generate`, at which point
   * drizzle-kit would have diffed a PK-less table against a PK'd one and emitted
   * a migration to "fix" the difference in the wrong direction.
   */
  (t) => ({ pk: primaryKey({ columns: [t.feedDate, t.version] }) }),
);

/**
 * Every credit movement, append-only. See migration 0004.
 *
 * Evidence, not state: `users.analysis_count` remains the balance. Nothing in
 * the request path reads this, which is what lets the writes be fire-and-forget.
 */
export const creditEvents = mysqlTable(
  'credit_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    /** +1 charge, -1 refund. */
    delta: tinyint('delta').notNull(),
    /** Fixed vocabulary, never user content — same rule as lib/logger.ts. */
    reason: varchar('reason', { length: 32 }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({ idxUser: index('idx_ce_user').on(t.userId, t.createdAt) }),
);

/**
 * Replay protection for `/v1/ai/*`. See middleware/idempotency.ts.
 *
 * `<user_id>:<Idempotency-Key>`, so one user's key cannot collide with another's.
 * `status = 0` means claimed but unfinished.
 */
export const idempotency = mysqlTable(
  'idempotency',
  {
    id: varchar('id', { length: 200 }).primaryKey(),
    status: smallint('status', { unsigned: true }).notNull(),
    body: mediumtext('body'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({ idxCreated: index('idx_idem_created').on(t.createdAt) }),
);

/**
 * Token buckets shared across instances — `/v1/auth/*` only.
 *
 * Not a cache and not optional: it is the brute-force limiter in front of a
 * product with no password reset, and the in-process Map it replaces there was
 * per-lambda. Everything else still uses the in-process bucket. See
 * middleware/rateLimit.ts for which gets which and why.
 *
 * `tokens` is DOUBLE because refill is fractional — `refillPerSec` of 0.05 on
 * the login bucket adds three thousandths of a token a second, and rounding that
 * to an INT means the bucket never refills at all.
 */
export const rateLimits = mysqlTable(
  'rate_limits',
  {
    /** `<scope>:<by>:<id>` — see dbRateLimit(). */
    bucket: varchar('bucket', { length: 160 }).primaryKey(),
    tokens: double('tokens').notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({ idxUpdated: index('idx_rl_updated').on(t.updatedAt) }),
);

/**
 * Emailed one-time codes. See migration 0005 and lib/otp.ts.
 *
 * The one place an email address lives outside `users`, and deliberately
 * short-lived: rows are single-use, expire in ten minutes and are swept. It is
 * not a log of who tried to sign up — a consumed code leaves nothing behind.
 */
export const emailOtps = mysqlTable(
  'email_otps',
  {
    email: varchar('email', { length: 255 }).notNull(),
    /** 'signup' | 'login'. Part of the PK, so the two can never be swapped. */
    purpose: varchar('purpose', { length: 16 }).notNull(),
    /** SHA-256 hex of `<email>:<purpose>:<code>`. Never the code itself. */
    codeHash: char('code_hash', { length: 64 }).notNull(),
    attempts: smallint('attempts', { unsigned: true }).notNull().default(0),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    /** Doubles as the resend cooldown clock. */
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.email, t.purpose] }),
    idxExpires: index('idx_otp_expires').on(t.expiresAt),
  }),
);

/** RevenueCat webhook idempotency only (Phase 3). No billing content stored. */
export const rcEvents = mysqlTable(
  'rc_events',
  {
    eventId: varchar('event_id', { length: 128 }).primaryKey(),
    /*
     * VARCHAR(128), not CHAR(36): this holds RevenueCat's `app_user_id`, not a
     * `users.id`. It is a UUID today, but a legacy or sandbox row carries
     * `$RCAnonymousID:<32 hex>` = 46 chars, which under strict mode threw
     * ER_DATA_TOO_LONG and 500'd the whole webhook. Matches
     * `users.rc_app_user_id`. See migration 0004.
     */
    userId: varchar('user_id', { length: 128 }),
    type: varchar('type', { length: 48 }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({ idxCreated: index('idx_rc_created').on(t.createdAt) }),
);

/** Profile scans summary storage per user (no raw images saved). */
export const profileScans = mysqlTable(
  'profile_scans',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    mode: mysqlEnum('mode', ['self', 'them']).notNull(),
    title: varchar('title', { length: 128 }),
    summaryJson: json('summary_json').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({ idxUserCreated: index('idx_ps_user_created').on(t.userId, t.createdAt) }),
);

/** Saved lines / vault items per user. */
export const savedItems = mysqlTable(
  'saved_items',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    text: mediumtext('text').notNull(),
    note: varchar('note', { length: 255 }),
    savedAt: bigint('saved_at', { mode: 'number' }).notNull(),
  },
  (t) => ({ idxUserSaved: index('idx_si_user_saved').on(t.userId, t.savedAt) }),
);


