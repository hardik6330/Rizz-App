import type { MiddlewareHandler } from 'hono';

import { Errors } from '../lib/errors.ts';
import { verifyAccess, type Claims } from '../lib/jwt.ts';

declare module 'hono' {
  interface ContextVariableMap {
    user: Claims;
  }
}

/** Bearer JWT → c.get('user'). Every route except /auth/* and /healthz. */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Errors.unauthorized();

  try {
    c.set('user', await verifyAccess(token));
  } catch {
    throw Errors.unauthorized();
  }
  await next();
};
