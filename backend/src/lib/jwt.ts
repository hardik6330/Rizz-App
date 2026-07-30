import { SignJWT, jwtVerify } from 'jose';

import { env } from '../env.ts';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';

export interface Claims {
  sub: string;      // users.id
  pro: boolean;
}

/** 24h access token. Short enough that a revoked entitlement takes effect fast. */
export async function signAccess(claims: Claims): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = 60 * 60 * 24;
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
