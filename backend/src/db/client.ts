import { readFileSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { env } from '../env.ts';
import { RAILWAY_MYSQL_CA } from './railway-ca.ts';
import * as schema from './schema.ts';

/**
 * One pool for the process.
 *
 * `timezone: 'Z'` is load-bearing. `limits.ts::todayKey()` uses
 * `toISOString().slice(0,10)` — i.e. UTC — so every DATE column must be UTC too.
 * Get this wrong and a user near midnight sees a limit that has reset locally but
 * not on the server. Never use CURDATE(); always pass todayKey().
 */
export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  /*
   * 10 for a long-lived process, 1 on Vercel.
   *
   * Serverless multiplies this by every warm instance, and a small managed MySQL
   * plan caps max_connections in the low tens — so a pool of 10 exhausts the
   * database at ~3 concurrent instances and every further request fails to
   * connect, not slowly but immediately. The ceiling is the plan's, not the
   * vendor's. Vercel sets VERCEL=1 itself; nothing to configure.
   */
  connectionLimit: process.env.VERCEL ? 1 : 10,
  enableKeepAlive: true,
  /*
   * Fail fast. A blocked IP allowlist drops packets rather than refusing them,
   * so without this the connect hangs until Vercel kills the function at 60s and
   * logs a timeout instead of the real error — and the client, having waited a
   * minute, quietly serves mock data.
   */
  connectTimeout: 8_000,
  timezone: 'Z',
  /*
   * `rejectUnauthorized` stays true in both branches. Every row this connection
   * carries is a credit balance or a purchase state, and the traffic crosses the
   * public internet to a managed host — an unverified peer is a silent MITM.
   * `ssl: { rejectUnauthorized: false }` is the usual fix for a managed-MySQL
   * cert error; supply DATABASE_CA instead.
   */
  /*
   * `checkServerIdentity` is skipped because a CA is pinned. Railway's MySQL
   * serves MySQL's own auto-generated cert, whose CN is
   * `MySQL_Server_9.4.0_Auto_Generated_Server_Certificate` — it can never match
   * `*.proxy.rlwy.net`, so the hostname check fails on a cert that is otherwise
   * exactly the one we expect. Pinning the issuing CA is the stronger guarantee
   * anyway: its key is unique to this instance, so only this server can present
   * a chain that verifies.
   */
  // The cast is mysql2's SslOptions omitting checkServerIdentity from its types;
  // it forwards the whole object to tls.connect, which honours it.
  ssl: {
    ca: databaseCa(),
    rejectUnauthorized: true,
    checkServerIdentity: () => undefined,
  } as mysql.SslOptions,
});

/**
 * The CA to verify the database against. Needs no configuration.
 *
 * Defaults to the bundled Railway CA in `railway-ca.ts` — see that file for why
 * shipping a certificate in git is fine and a password is not. `DATABASE_CA` is
 * now an OPTIONAL override, kept for two cases only: pointing at a different
 * managed provider, and replacing a rotated Railway CA without a deploy. It
 * accepts either the PEM text or a path to it.
 *
 * It used to be required, and getting it wrong was the most expensive
 * misconfiguration in the service: this module is evaluated at import, so a bad
 * value crashed the function before it served anything and every route 500'd.
 * A default that is always correct removes that failure mode entirely.
 */
function databaseCa(): string {
  const value = env.DATABASE_CA;
  if (!value) return RAILWAY_MYSQL_CA;
  return value.includes('-----BEGIN') ? value : readFileSync(value, 'utf8');
}

export const db = drizzle(pool, { schema, mode: 'default' });
