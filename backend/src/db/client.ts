import { readFileSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { env } from '../env.ts';
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
   * Serverless multiplies this by every warm instance, and Aiven's smaller plans
   * cap max_connections in the low tens — so a pool of 10 exhausts the database
   * at ~3 concurrent instances and every further request fails to connect, not
   * slowly but immediately. Vercel sets VERCEL=1 itself; nothing to configure.
   */
  connectionLimit: process.env.VERCEL ? 1 : 10,
  enableKeepAlive: true,
  /*
   * Fail fast. A blocked Aiven allowlist drops packets rather than refusing them,
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
   * `checkServerIdentity` is skipped ONLY when a CA is pinned. Railway's MySQL
   * serves MySQL's own auto-generated cert, whose CN is
   * `MySQL_Server_9.4.0_Auto_Generated_Server_Certificate` — it can never match
   * `*.proxy.rlwy.net`, so the hostname check fails on a cert that is otherwise
   * exactly the one we expect. Pinning the issuing CA is the stronger guarantee
   * anyway: its key is unique to this instance, so only this server can present
   * a chain that verifies. With no CA pinned this stays undefined and Node does
   * the full public-CA + hostname check.
   */
  // The cast is mysql2's SslOptions omitting checkServerIdentity from its types;
  // it forwards the whole object to tls.connect, which honours it.
  ssl: (databaseCa()
    ? { ca: databaseCa(), rejectUnauthorized: true, checkServerIdentity: () => undefined }
    : { rejectUnauthorized: true }) as mysql.SslOptions,
});

/**
 * DATABASE_CA is either the PEM itself or a path to it.
 *
 * Locally it is a path (`./ca.pem`). In production there is no file to point at:
 * Render and Railway hand you environment variables and no writable place to put
 * a credential, and a cert committed to git so the deploy can find it defeats the
 * point. So a value starting with the PEM header is used verbatim — paste the
 * certificate straight into the platform's env var, newlines and all.
 *
 * Undefined means "verify against Node's system CAs", which is right for a local
 * MySQL and is the safe default everywhere else: TLS is never silently skipped.
 */
function databaseCa(): string | undefined {
  const value = env.DATABASE_CA;
  if (!value) return undefined;
  return value.includes('-----BEGIN') ? value : readFileSync(value, 'utf8');
}

export const db = drizzle(pool, { schema, mode: 'default' });
