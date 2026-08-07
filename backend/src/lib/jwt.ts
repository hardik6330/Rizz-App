import { SignJWT, jwtVerify } from 'jose';

import { env } from '../env.ts';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';

export interface Claims {
  sub: string;      // users.id
  pro: boolean;
  /**
   * `users.token_epoch` as of signing. `requireAuth` rejects the token when the
   * row has moved past it, which is what makes sign-out mean something.
   */
  ep: number;
  /**
   * Minted by `/v1/auth/device` from an install id alone — no password was
   * involved. See `requireAccount` in middleware/auth.ts.
   *
   * The install id is a permanent bearer credential that deliberately SURVIVES
   * sign-out (dropping it would hand out three fresh free analyses per sign-out).
   * But signup claims the install's row, so that id resolves to the account —
   * which meant `/device` would happily mint a full account session for anyone
   * holding it, walking straight around the `token_epoch` revocation `/logout`
   * exists to provide.
   *
   * Absent on a token signed before this shipped, and absent means `false`: an
   * existing field token was minted for a real session and must keep working.
   */
  dev?: boolean;
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
 *
 * A long token needs a kill switch that is not "ban the user", which is what
 * `ep` is. Without it, sign-out was a client-side MMKV delete: the token stayed
 * valid for the rest of its 30 days on any device, backup or proxy log holding a
 * copy, and nothing could stop it.
 */
export async function signAccess(claims: Claims): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = 60 * 60 * 24 * 30;
  // `dev` omitted rather than sent as false: an account token is the norm, and a
  // claim that is absent by default cannot be forgotten into the wrong value.
  const token = await new SignJWT({ pro: claims.pro, ep: claims.ep, ...(claims.dev ? { dev: true } : {}) })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);
  return { token, expiresIn };
}

export async function verifyAccess(token: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  return {
    sub: String(payload.sub),
    pro: payload.pro === true,
    // Absent on a token signed before this shipped. 0 matches the column
    // default, so every existing token stays valid until its own expiry —
    // the alternative is signing out every user in the field on deploy day.
    ep: typeof payload.ep === 'number' ? payload.ep : 0,
    // Absent → account token. See the note on `dev` above: existing field tokens
    // carry no claim and must not be downgraded on deploy day.
    dev: payload.dev === true,
  };
}
