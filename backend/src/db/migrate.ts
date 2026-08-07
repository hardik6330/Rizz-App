/**
 * Apply pending migrations. Safe to run against a fresh database OR the one
 * already carrying 0000 and 0001 by hand.
 *
 *   cd backend && node --env-file=.env --import tsx src/db/migrate.ts
 *
 * ## Why this file exists
 *
 * `src/db/migrations/*.sql` were hand-written and applied by pasting them into a
 * console. There was no `meta/_journal.json`, so `drizzle-kit migrate` could not
 * read them and nothing in either deploy ran them — which meant the only record
 * of what had been applied to which database was somebody's memory. The failure
 * mode is not dramatic, it is quiet: a route referencing a column that exists on
 * your laptop and not in production, discovered by users.
 *
 * ## Adoption
 *
 * Drizzle's MySQL migrator decides what to run by comparing `folderMillis`
 * against the newest `created_at` in `__drizzle_migrations` — not by hash. So
 * adopting an existing database is one INSERT, and it is done here rather than
 * in a separate command nobody would remember to run: if `users` already exists
 * but the bookkeeping table does not, this database predates the journal, and
 * everything up to and including 0001 is already in it by definition.
 *
 * ## Where to run it
 *
 * Render's build can reach the database, so render.yaml runs it there. Vercel's
 * build cannot — the database sits behind an IP allowlist and build containers
 * have no stable egress — so on Vercel this is a deliberate step from a machine
 * that can reach it, BEFORE promoting the deploy.
 */
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';

import { db, pool } from './client.ts';
import { log } from '../lib/logger.ts';

const migrationsFolder = new URL('./migrations', import.meta.url).pathname;

async function tableExists(name: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT COUNT(*) AS n
      FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ${name}
  `);
  return (((rows as unknown as [Array<{ n: number }>])[0]?.[0]?.n ?? 0) as number) > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT COUNT(*) AS n
      FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ${table} AND column_name = ${column}
  `);
  return (((rows as unknown as [Array<{ n: number }>])[0]?.[0]?.n ?? 0) as number) > 0;
}

async function eventExists(name: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT COUNT(*) AS n
      FROM information_schema.events
     WHERE event_schema = DATABASE() AND event_name = ${name}
  `);
  return (((rows as unknown as [Array<{ n: number }>])[0]?.[0]?.n ?? 0) as number) > 0;
}

/**
 * One cheap probe per migration, newest last. `when` MUST match meta/_journal.json.
 *
 * Detecting what is actually in the database beats a hardcoded baseline, because
 * the hardcoded one was wrong: it named 0001 while this database had been taken
 * to 0003 by hand, so the adoption would have re-run 0002 and 0003 against
 * objects that already existed and failed on the first `CREATE TABLE`.
 *
 * Each probe names something the migration ADDS, so "present" means "applied".
 */
const PROBES: { when: number; tag: string; applied: () => Promise<boolean> }[] = [
  { when: 1750000000000, tag: '0000_init', applied: () => tableExists('users') },
  { when: 1755000000000, tag: '0001_accounts', applied: () => columnExists('users', 'email') },
  { when: 1760000000000, tag: '0002_rate_limits', applied: () => tableExists('rate_limits') },
  { when: 1765000000000, tag: '0003_token_epoch', applied: () => columnExists('users', 'token_epoch') },
  { when: 1770000000000, tag: '0004_ledger_idempotency', applied: () => tableExists('credit_events') },
  { when: 1775000000000, tag: '0005_email_otp', applied: () => tableExists('email_otps') },
  { when: 1776000000000, tag: '0006_otp_retention', applied: () => eventExists('ev_email_otps_gc') },
  { when: 1777000000000, tag: '0007_otp_send_cap', applied: () => columnExists('email_otps', 'sends') },
];

/** The newest migration whose effects are already present, or null for a fresh DB. */
async function detectBaseline(): Promise<{ when: number; tag: string } | null> {
  let latest: { when: number; tag: string } | null = null;
  for (const probe of PROBES) {
    if (await probe.applied()) latest = { when: probe.when, tag: probe.tag };
    else break; // migrations are ordered; the first gap is where we resume
  }
  return latest;
}

/** Has the journal got any row at all? The TABLE existing is not the same thing. */
async function journalIsEmpty(): Promise<boolean> {
  if (!(await tableExists('__drizzle_migrations'))) return true;
  const rows = await db.execute(sql`SELECT COUNT(*) AS n FROM \`__drizzle_migrations\``);
  return (((rows as unknown as [Array<{ n: number }>])[0]?.[0]?.n ?? 0) as number) === 0;
}

try {
  const baseline = await detectBaseline();

  /*
   * Adopt, only when the journal has nothing in it.
   *
   * The check used to be "does the __drizzle_migrations TABLE exist", which is a
   * different question and got the wrong answer: a previous partial run had
   * created the table and written no rows, so this branch was skipped, drizzle
   * saw an empty journal, and tried to run 0000_init against a live database.
   * The failure was `Table 'users' already exists` — loud, at least, but it made
   * the runner unusable exactly when it was needed.
   */
  if (baseline && (await journalIsEmpty())) {
    /*
     * Same DDL drizzle would create, so its own `create table if not exists` is
     * a no-op afterwards. The hash is a marker, never compared — see above.
     */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `);
    await db.execute(sql`
      INSERT INTO \`__drizzle_migrations\` (hash, created_at)
      VALUES (${`baseline:${baseline.tag}`}, ${baseline.when})
    `);
    log.warn('db.migrate.baseline', {
      note: `detected as applied up to and including ${baseline.tag}`,
    });
  }

  await migrate(db, { migrationsFolder });
  log.info('db.migrate.ok', { fresh: baseline === null });

  /*
   * `CREATE EVENT` succeeds on a server whose scheduler is OFF. The event is
   * stored, shows up in information_schema, satisfies the probe above — and
   * never runs. That is the one failure mode of migration 0006 and it is
   * completely silent, so it gets checked here, where somebody is watching.
   *
   * Not fatal: the opportunistic sweep in lib/otp.ts still deletes expired codes
   * on any instance that sees traffic, so this degrades to "cleanup depends on
   * traffic again" rather than "codes are kept for ever". Fix with
   *   SET GLOBAL event_scheduler = ON;
   * (or the provider's equivalent — it is a server variable, not a database one).
   */
  const [[scheduler]] = (await db.execute(
    sql`SELECT @@event_scheduler AS state`,
  )) as unknown as [Array<{ state: string }>];
  if (scheduler?.state !== 'ON') {
    log.warn('db.event_scheduler.off', {
      state: scheduler?.state ?? 'unknown',
      note: 'ev_email_otps_gc will NOT run — OTP cleanup falls back to the traffic-driven sweep',
    });
  }
} catch (err) {
  log.error('db.migrate.failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
