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

/** Must match the `when` of 0001_accounts in meta/_journal.json. */
const BASELINE_WHEN = 1755000000000;

const migrationsFolder = new URL('./migrations', import.meta.url).pathname;

async function tableExists(name: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT COUNT(*) AS n
      FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ${name}
  `);
  return (((rows as unknown as [Array<{ n: number }>])[0]?.[0]?.n ?? 0) as number) > 0;
}

try {
  const hasUsers = await tableExists('users');
  const hasJournal = await tableExists('__drizzle_migrations');

  if (hasUsers && !hasJournal) {
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
      VALUES ('baseline:0001_accounts', ${BASELINE_WHEN})
    `);
    log.warn('db.migrate.baseline', { note: '0000 and 0001 marked applied' });
  }

  await migrate(db, { migrationsFolder });
  log.info('db.migrate.ok', { fresh: !hasUsers });
} catch (err) {
  log.error('db.migrate.failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
