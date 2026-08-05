import { SignJWT, jwtVerify } from 'jose';

import { env } from '../env.ts';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';

export interface Claims {
  sub: string;      // users.id
  pro: boolean;
}

/**
 * 30-day access token.
 *
 * It was 24h, on the reasoning that a short token makes a revoked entitlement
 * take effect fast. `requireAuth` now reads `is_pro` and `banned_at` off the row
 * on every request, so revocation is immediate regardless of token lifetime and
 * that argument no longer applies.
 *
 * What does apply: there is no password reset. A user who is signed out and has
 * forgotten their password has lost the account. A 24h token means that happens
 * to somebody every single day.
 */
export async function signAccess(claims: Claims): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = 60 * 60 * 24 * 30;
  const token = await new SignJWT({ pro: claims.pro })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);
  return { token, expiresIn };
}

export async function verifyAccess(token: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  return { sub: String(payload.sub), pro: payload.pro === true };
}
