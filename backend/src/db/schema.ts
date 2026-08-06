import { bigint, char, date, double, index, int, json, mysqlEnum, mysqlTable, smallint, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

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
     * analyses. No verification and no reset in v1 — see routes/auth.ts.
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
export const dailyFeed = mysqlTable('daily_feed', {
  feedDate: date('feed_date', { mode: 'string' }).notNull(),
  version: smallint('version', { unsigned: true }).notNull(),
  itemsJson: json('items_json').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

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

/** RevenueCat webhook idempotency only (Phase 3). No billing content stored. */
export const rcEvents = mysqlTable(
  'rc_events',
  {
    eventId: varchar('event_id', { length: 128 }).primaryKey(),
    userId: char('user_id', { length: 36 }),
    type: varchar('type', { length: 48 }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({ idxCreated: index('idx_rc_created').on(t.createdAt) }),
);
