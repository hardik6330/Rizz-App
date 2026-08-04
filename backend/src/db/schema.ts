import { bigint, char, date, index, int, json, mysqlEnum, mysqlTable, smallint, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

/**
 * Three tables. See docs/README.md §5 for what is deliberately absent
 * and the condition that earns each deferred table.
 *
 * NEVER add: images, transcripts, replies, reports, saved items, or any PII.
 */

/** Anonymous. One row per install. The only genuinely unavoidable table. */
export const users = mysqlTable(
  'users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    installId: char('install_id', { length: 36 }).notNull(),
    rcAppUserId: varchar('rc_app_user_id', { length: 128 }),
    platform: mysqlEnum('platform', ['ios', 'android']).notNull(),
    appVersion: varchar('app_version', { length: 24 }),

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
  }),
);

/** Generated ONCE per day, globally. The PK doubles as the cron idempotency guard. */
export const dailyFeed = mysqlTable('daily_feed', {
  feedDate: date('feed_date', { mode: 'string' }).notNull(),
  version: smallint('version', { unsigned: true }).notNull(),
  itemsJson: json('items_json').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

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
