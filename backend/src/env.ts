import { z } from 'zod';

/**
 * Validated config, checked at boot.
 *
 * Fails loudly and exits rather than starting half-configured. The entire class
 * of bug this service exists to prevent is "ran silently without a real key" —
 * which is exactly how the client behaves today, where a stub key drops every
 * engine into mock data with only a console.warn to show for it.
 */

/**
 * An optional variable, where a BLANK line counts as unset.
 *
 * `.optional()` alone is not enough, and the difference is the whole reason this
 * exists: `KEY=` in a .env file gives `process.env.KEY === ''`, which is present,
 * so zod runs the format rule against an empty string and rejects it. The
 * process then exits with `must start with "sk_"` for a key the user
 * deliberately left blank — and the fix is invisible, because the line looks
 * exactly like the ones that work.
 *
 * `.env.example` is committed with these keys present and empty, which is what
 * makes it a real trap rather than a hypothetical one: copy the file, run the
 * server, get a validation failure naming a variable you were told to leave
 * alone. Empty means "I have not set this", so that is what it is treated as.
 */
const blankIsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const Env = z.object({
  GEMINI_API_KEY: z.string().min(30, 'missing or a stub'),
  JWT_SECRET: z.string().min(32, 'must be >=32 chars — openssl rand -hex 32'),
  REVENUECAT_WEBHOOK_SECRET: blankIsUnset(z.string()),

  /**
   * RevenueCat **secret** API key (`sk_…`) — server-only, never the `goog_`/`appl_`
   * public SDK keys the app ships.
   *
   * Unset puts entitlement in the same mock mode the client already documents in
   * AGENTS.md: the paywall grants Pro for free, so the server accepting the
   * client's claim is not a new hole, it is the existing one. It is logged loudly
   * rather than silently, which is the part that actually bit before.
   */
  REVENUECAT_SECRET_KEY: blankIsUnset(z.string().startsWith('sk_')),
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
  DATABASE_CA: blankIsUnset(z.string()),
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** Global kill switch. false → every /ai/* 503s and clients serve mock seeds. */
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Point at Cloudflare AI Gateway to get retries + cost logging for free. */
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),

  /*
   * ── SMTP, as separate fields ───────────────────────────────────────────────
   *
   * HOST, USER and PASS are REQUIRED in production — see the refinement below.
   * Leave them blank in development and the code is written to the log instead
   * of sent, which is what makes the whole flow testable with no mail server;
   * that fallback is refused in production because it would print live login
   * codes into whatever aggregates the logs.
   *
   * The cost of splitting a URL into fields is that a half-filled set is now
   * expressible — a host with no password, and you find out at the first signup.
   * The refinement below closes that by requiring the three together, so the
   * only two valid states remain "all set" and "none set".
   */

  /** e.g. `smtp.gmail.com`, `smtp-relay.brevo.com`. Host only — no scheme, no port. */
  SMTP_HOST: blankIsUnset(z.string().min(1)),
  /**
   * 465 (implicit TLS) by default, or 587 for STARTTLS. Both encrypt; use
   * whichever your provider documents. Never 25 — that is the unencrypted one,
   * and this connection carries a password on every send.
   *
   * The port also SELECTS the mode in mailer.ts (`secure: port === 465`), which
   * is why it is a number here and not a string.
   */
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(465),
  /**
   * The login. On Gmail and Brevo this is your email address; on Mailgun it is
   * `postmaster@<domain>`; on SES it is an IAM SMTP key, which is NOT an address
   * — see MAIL_FROM.
   */
  SMTP_USER: blankIsUnset(z.string().min(1)),
  /**
   * The password. On Gmail this must be a 16-character **App Password** (Google
   * account → 2-Step Verification → App passwords); your normal account password
   * will not authenticate over SMTP and never will.
   */
  SMTP_PASS: blankIsUnset(z.string().min(1)),
  /**
   * The From header, e.g. `RizzCoach <no-reply@rizzcoach.app>`.
   *
   * OPTIONAL: blank falls back to `SMTP_USER`, which is correct for Gmail,
   * Brevo and Mailgun, where the login is itself a sendable address. Set it
   * explicitly for SES, whose SMTP user is an access key rather than an email —
   * leaving it blank there produces a From the provider rejects.
   *
   * Whatever it is, it must be an address the SMTP account is allowed to send
   * as, or every message bounces and signup fails at the code step. Not
   * checkable here: only the provider knows.
   */
  MAIL_FROM: blankIsUnset(z.string().max(255)),
})
  /*
   * Mock entitlement is a development convenience and a production hole.
   *
   * Without REVENUECAT_SECRET_KEY the server believes `claimed_pro` — so anyone
   * who unpacks the APK has a free subscription for ever, and the log line that
   * says so scrolls past on a server nobody is watching. Without
   * REVENUECAT_WEBHOOK_SECRET the webhook 503s and cancellations never land.
   *
   * Failing to boot is the point: a subscription business that silently gives
   * itself away is worse than one that is down.
   */
  /*
   * ...and the same for SMTP, for a different reason.
   *
   * Signup cannot complete without a code, and /login's only recovery path is a
   * code. So a production instance with no mailer cannot create an account and
   * cannot let a user who forgot their password back in — the app is a signup
   * screen that never succeeds. Without this check the fallback in lib/mailer.ts
   * would instead print live login codes into the log stream, which is worse
   * than not booting in exactly the way REVENUECAT_SECRET_KEY is.
   *
   * MAIL_FROM is deliberately NOT in that list: blank means "same as SMTP_USER",
   * which is right for every provider whose login is an address.
   */
  .superRefine((v, ctx) => {
    /*
     * A PARTIAL SMTP set is invalid everywhere, production or not.
     *
     * This is the failure the single-URL form could not express and the split
     * one can: a host with no password reads as "mail is configured", so
     * `mailer()` builds a transport, every send fails authentication, and the
     * user meets "Could not send the code" on a server whose logs say the mailer
     * is up. Checked outside the production branch because getting two of three
     * into a .env is a development mistake first.
     */
    const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const;
    const set = smtp.filter((k) => v[k]);
    if (set.length > 0 && set.length < smtp.length) {
      for (const key of smtp) {
        if (!v[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required once any other SMTP_* is set — set all three, or leave all three blank',
          });
        }
      }
    }

    if (v.NODE_ENV !== 'production') return;
    for (const key of [
      'REVENUECAT_SECRET_KEY',
      'REVENUECAT_WEBHOOK_SECRET',
      ...smtp,
    ] as const) {
      if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
  });

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`[env] invalid configuration:\n${detail}`);
  process.exit(1);
}

export const env = parsed.data;
