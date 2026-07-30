import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.ts';
import { Errors } from '../lib/errors.ts';
import { signAccess } from '../lib/jwt.ts';
import { FREE_ANALYSIS_LIMIT } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';

/**
 * Anonymous device identity. No email, no password, no signup screen.
 *
 * This is a dating-confidence product: asking for an account before the first
 * analysis would destroy activation, and it would create a PII store we
 * otherwise do not have. Identity is a device, not a person.
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

auth.post('/device', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.badRequest('install_id and platform are required');
  const { platform, app_version } = parsed.data;
  const install_id = parsed.data.install_id ?? randomUUID();

  const now = Date.now();
  const id = randomUUID();

  // Upsert on install_id. The UNIQUE key makes concurrent first-launch races a
  // no-op rather than a duplicate user with a fresh set of free credits.
  await db.execute(sql`
    INSERT INTO users (id, install_id, platform, app_version, created_at, updated_at)
    VALUES (${id}, ${install_id}, ${platform}, ${app_version ?? null}, ${now}, ${now})
    ON DUPLICATE KEY UPDATE app_version = VALUES(app_version), updated_at = ${now}
  `);

  const rows = await db.execute(sql`
    SELECT id, is_pro, analysis_count, banned_at FROM users WHERE install_id = ${install_id} LIMIT 1
  `);
  const user = (rows as unknown as [Array<{ id: string; is_pro: number; analysis_count: number; banned_at: number | null }>])[0]?.[0];
  if (!user) throw Errors.badRequest('could not create device');
  if (user.banned_at) throw Errors.banned();

  const isPro = user.is_pro === 1;
  const { token, expiresIn } = await signAccess({ sub: user.id, pro: isPro });
  log.info('auth.device', { platform, isNew: user.id === id });

  return c.json({
    access_token: token,
    expires_in: expiresIn,
    // Echoed back so a first-launch client can persist the id the server minted.
    install_id,
    user: {
      is_pro: isPro,
      analysis_count: user.analysis_count,
      credits_remaining: isPro ? null : Math.max(0, FREE_ANALYSIS_LIMIT - user.analysis_count),
      limits: { free_analysis: FREE_ANALYSIS_LIMIT },
    },
  });
});
