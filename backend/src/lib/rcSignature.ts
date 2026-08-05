import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a RevenueCat webhook.
 *
 * RevenueCat offers two schemes and you pick one in their dashboard, so both are
 * accepted here rather than forcing a re-configuration:
 *
 *   1. **HMAC** (recommended) — `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>`
 *      where the hex is HMAC-SHA256 of `"<t>.<raw body>"` under the shared secret.
 *   2. **Static header** — the secret verbatim in `Authorization`.
 *
 * The raw body matters: re-serialising the parsed JSON changes key order and
 * whitespace, and the signature stops matching for reasons nothing in the log
 * will explain.
 *
 * This endpoint is the only unauthenticated write in the service and it flips
 * `is_pro`, so a forged POST is a free subscription. There is no "log it and
 * continue" branch on purpose.
 */
const TOLERANCE_MS = 5 * 60_000;

export function verifyWebhook(
  secret: string,
  rawBody: string,
  headers: { signature?: string; authorization?: string },
  now: number = Date.now(),
): boolean {
  if (!secret) return false;

  if (headers.signature) {
    const parts = new Map(
      headers.signature.split(',').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
      }),
    );
    const t = parts.get('t');
    const v1 = parts.get('v1');
    if (!t || !v1) return false;

    // Replay window. Without it a captured EXPIRATION body can be re-sent for
    // ever; with it the signature is only good for five minutes.
    const ts = Number(t) * 1000;
    if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_MS) return false;

    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return equal(expected, v1);
  }

  // Static-header mode. `Bearer ` is tolerated because the dashboard field takes
  // the whole header value and it is easy to paste either form.
  const given = (headers.authorization ?? '').replace(/^Bearer /, '');
  return equal(secret, given);
}

/** Constant-time compare that tolerates a length mismatch. */
function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Compare something of equal length either way, so the reject is not a timer.
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
