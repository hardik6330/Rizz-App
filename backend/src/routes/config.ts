import { Hono } from 'hono';

import { env } from '../env.ts';

export const config = new Hono();

/**
 * Server-driven config, polled on launch. `ai_enabled: false` is the global kill
 * switch: clients degrade to their mock seeds exactly as they do today when the
 * key is a stub, which is why the seeds must stay in the bundle.
 */
config.get('/', (c) =>
  c.json({
    ai_enabled: env.AI_ENABLED,
    min_supported_version: '1.0.0',
    flags: {},
  }),
);
