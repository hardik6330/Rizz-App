import { z } from 'zod';

/**
 * Validated config, checked at boot.
 *
 * Fails loudly and exits rather than starting half-configured. The entire class
 * of bug this service exists to prevent is "ran silently without a real key" —
 * which is exactly how the client behaves today, where a stub key drops every
 * engine into mock data with only a console.warn to show for it.
 */
const Env = z.object({
  GEMINI_API_KEY: z.string().min(30, 'missing or a stub'),
  JWT_SECRET: z.string().min(32, 'must be >=32 chars — openssl rand -hex 32'),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),

  /**
   * RevenueCat **secret** API key (`sk_…`) — server-only, never the `goog_`/`appl_`
   * public SDK keys the app ships.
   *
   * Unset puts entitlement in the same mock mode the client already documents in
   * AGENTS.md: the paywall grants Pro for free, so the server accepting the
   * client's claim is not a new hole, it is the existing one. It is logged loudly
   * rather than silently, which is the part that actually bit before.
   */
  REVENUECAT_SECRET_KEY: z.string().startsWith('sk_').optional(),
  DATABASE_URL: z.string().url(),

  /**
   * OPTIONAL override for the database CA — the PEM itself, or a path to it.
   *
   * Unset is the normal case: `db/railway-ca.ts` bundles the CA that signs
   * Railway's MySQL certificate, so TLS verifies with no configuration at all.
   * A certificate is not a credential (it carries a public key), which is why it
   * can live in git while `DATABASE_URL` cannot.
   *
   * Set it only to point at a different provider, or to replace a rotated
   * Railway CA without shipping a deploy. Never to disable verification — every
   * row on this connection is a credit balance, a purchase state or a password
   * hash, and the traffic crosses the public internet.
   */
  DATABASE_CA: z.string().optional(),
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** Global kill switch. false → every /ai/* 503s and clients serve mock seeds. */
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Point at Cloudflare AI Gateway to get retries + cost logging for free. */
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`[env] invalid configuration:\n${detail}`);
  process.exit(1);
}

export const env = parsed.data;
