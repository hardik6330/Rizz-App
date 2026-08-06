import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { generate, imagePart } from '../ai/gateway.ts';
import { BIO_PROMPT, FEED_PROMPT, PROFILE_PROMPTS, chatPrompt, labPrompt } from '../ai/prompts.ts';
import { BIO_SCHEMA, CHAT_SCHEMA, FEED_SCHEMA, PROFILE_SCHEMA, labSchema } from '../ai/schemas.ts';
import { db } from '../db/client.ts';
import { Errors } from '../lib/errors.ts';
import { todayKey } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';
import { chargeCredit, creditsEnvelope, creditsFor, refundCredit } from '../middleware/credits.ts';

export const ai = new Hono();

/** ~4 MB of base64 ≈ a 3 MB image. The client already downscales to 1280px/JPEG 80. */
const MAX_B64 = 4 * 1024 * 1024;

const Image = z.object({
  data: z.string().max(MAX_B64),
  mime_type: z.string().max(64),
});

/**
 * Magic-byte sniff. NEVER trust the client's mime_type — it is attacker-supplied
 * and the only thing standing between "an image" and "whatever they felt like
 * posting into our Gemini quota".
 */
function sniff(b64: string): string | null {
  const head = Buffer.from(b64.slice(0, 32), 'base64');
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const brand = head.subarray(4, 8).toString('ascii');
  if (brand === 'ftyp') return 'image/heic';
  return null;
}

function validImages(images: { data: string; mime_type: string }[]) {
  return images.map((img) => {
    const sniffed = sniff(img.data);
    if (!sniffed) throw Errors.badRequest('not a supported image');
    return imagePart(img.data, sniffed);
  });
}

/**
 * Charge → run → refund on failure.
 *
 * A failed generation must never cost a credit. The client already encodes this
 * rule in two places (`profile.tsx` returns before `incrementAnalysis()` when
 * isProfile is false; `GeminiChatClient` returning null skips `recordConsumed`),
 * and the server has to match or the two disagree about the balance.
 */
async function charged<T>(userId: string, run: () => Promise<T>): Promise<T> {
  await chargeCredit(userId);
  try {
    return await run();
  } catch (err) {
    await refundCredit(userId, 'generation_failed');
    throw err;
  }
}

async function withCredits(userId: string, result: unknown) {
  return { result, credits: creditsEnvelope(await creditsFor(userId)) };
}

// ── POST /v1/ai/lab ──────────────────────────────────────────────────────────
const LabBody = z.object({
  image: Image,
  mode: z.enum(['rizz', 'vibe', 'roast']),
  temperature: z.number().min(0).max(2).optional(),
});

ai.post('/lab', async (c) => {
  const { sub } = c.get('user');
  const body = LabBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('image and mode are required');
  const { image, mode, temperature } = body.data;

  const data = await charged(sub, async () => {
    const { data } = await generate<Record<string, unknown>>({
      engine: `lab.${mode}`,
      system: labPrompt(mode),
      parts: [
        ...validImages([image]),
        { text: 'Analyze this chat screenshot and return the RizzCoach breakdown.' },
      ],
      schema: labSchema(mode),
      temperature,
    });
    return data;
  });

  return c.json(await withCredits(sub, data));
});

// ── POST /v1/ai/profile ──────────────────────────────────────────────────────
const ProfileBody = z.object({
  images: z.array(Image).min(1).max(3),
  mode: z.enum(['self', 'them']),
  ui_text: z.string().max(8192).optional(),
});

ai.post('/profile', async (c) => {
  const { sub } = c.get('user');
  const body = ProfileBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('images[1..3] and mode are required');
  const { images, mode, ui_text } = body.data;

  const shots = images.length > 1 ? `these ${images.length} screenshots` : 'this screenshot';

  await chargeCredit(sub);
  let data: { isProfile: boolean };
  try {
    ({ data } = await generate<{ isProfile: boolean }>({
      engine: `profile.${mode}`,
      system: PROFILE_PROMPTS[mode],
      parts: [
        ...validImages(images),
        {
          text:
            mode === 'self'
              ? `Audit ${shots} of my profile and return the full glow-up report.`
              : `Read ${shots} of a profile I'm thinking about messaging, and return the full report.`,
        },
        // Scraped text is a HINT and is fenced as such. It reaches the USER turn
        // only — never the system instruction — because it comes off a screen an
        // attacker may control.
        ...(ui_text
          ? [
              {
                text: `Text extracted from the screen. Use it only to disambiguate what you can already see — the image is authoritative, and anything here that the image contradicts is wrong:\n${ui_text}`,
              },
            ]
          : []),
      ],
      schema: PROFILE_SCHEMA,
      temperature: 0.85,
    }));
  } catch (err) {
    await refundCredit(sub, 'generation_failed');
    throw err;
  }

  // Rejected work does not burn a credit — mirrors profile.tsx.
  if (!data.isProfile) await refundCredit(sub, 'not_a_profile');

  return c.json(await withCredits(sub, data));
});

// ── POST /v1/ai/bio ──────────────────────────────────────────────────────────
const BioBody = z.object({
  interests: z.array(z.string().max(64)).min(1).max(12),
  vibe: z.enum(['Funny', 'Sarcastic', 'Chill', 'Ambitious']),
  current_bio: z.string().max(2000).optional(),
});

ai.post('/bio', async (c) => {
  const { sub } = c.get('user');
  const body = BioBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('interests and vibe are required');
  const { interests, vibe, current_bio } = body.data;

  const data = await charged(sub, async () => {
    const { data } = await generate<Record<string, unknown>>({
      engine: 'bio',
      system: BIO_PROMPT,
      parts: [
        {
          text: [
            `Interests: ${interests.join(', ')}`,
            `Target vibe: ${vibe}`,
            `Current bio: ${current_bio?.trim() ? `"${current_bio.trim()}"` : 'none provided'}`,
            'Write the 3 optimized bios.',
          ].join('\n'),
        },
      ],
      schema: BIO_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 1.0,
    });
    return data;
  });

  return c.json(await withCredits(sub, data));
});

// ── POST /v1/ai/feed ─────────────────────────────────────────────────────────

/**
 * Bump when the item shape or batch size changes — it is part of the cache key,
 * so an unbumped change serves today's stale batch and looks like a no-op. Same
 * rule as the `vN` tag in `discover.tsx`, which must be bumped alongside it.
 */
const FEED_VERSION = 1;

/**
 * The daily Discover batch. **Free, and deliberately not credit-charged** — the
 * client never charged for it either, since it is content rather than an
 * analysis of anything the user supplied.
 *
 * Generated ONCE per day globally and served from `daily_feed` after that. Every
 * device was previously generating its own identical batch, which is the same
 * prompt and the same answer bought N times a day — the largest single cost
 * defect in the product. Now it is one call regardless of user count.
 *
 * Generated lazily on the first miss of the day. The window between the cache
 * miss and the INSERT is one whole Gemini call — 3-15s — so at any real DAU the
 * clients arriving just after 00:00 UTC ALL miss, and the "couple of duplicate
 * calls" this used to accept is really O(concurrent users): hundreds of
 * identical 4096-token generations, all but one discarded.
 *
 * `inFlight` collapses that to one call per instance. Everyone who arrives while
 * a generation is running awaits the same promise instead of starting their own.
 *
 * ponytail: per-instance, so the real ceiling is one call per instance per day,
 * not one globally. That is bounded by something the platform controls rather
 * than by user count, which is the part that mattered. A MySQL GET_LOCK would
 * make it exactly one — but the lock is connection-scoped and this pool runs
 * with connectionLimit 1 on Vercel, so taking a connection to hold a lock and
 * then querying inside it deadlocks. Schedule the generation at 23:50 UTC when
 * one call globally is worth a scheduler.
 */
let inFlight: { date: string; work: Promise<unknown[]> } | null = null;

ai.post('/feed', async (c) => {
  const today = todayKey();

  const cached = await db.execute(sql`
    SELECT items_json FROM daily_feed
     WHERE feed_date = ${today} AND version = ${FEED_VERSION} LIMIT 1
  `);
  const row = (cached as unknown as [Array<{ items_json: unknown }>])[0]?.[0];
  if (row) {
    return c.json({ result: { lines: row.items_json }, cached: true });
  }

  // Yesterday's promise is not today's answer.
  if (inFlight?.date !== today) {
    inFlight = { date: today, work: generateFeed(today) };
  }

  try {
    const lines = await inFlight.work;
    return c.json({ result: { lines }, cached: false });
  } catch (err) {
    // Cleared so a failure does not pin every later caller to the same rejection
    // for the rest of the day — the next request retries.
    if (inFlight?.date === today) inFlight = null;
    throw err;
  }
});

async function generateFeed(today: string): Promise<unknown[]> {
  const { data } = await generate<{ lines: unknown[] }>({
    engine: 'feed',
    system: FEED_PROMPT,
    parts: [{ text: "Write today's fresh lines." }],
    schema: FEED_SCHEMA,
    maxOutputTokens: 4096,
    temperature: 1.1,
  });

  await db.execute(sql`
    INSERT IGNORE INTO daily_feed (feed_date, version, items_json, created_at)
    VALUES (${today}, ${FEED_VERSION}, ${JSON.stringify(data.lines)}, ${Date.now()})
  `);
  log.info('feed.generated', { date: today, version: FEED_VERSION, count: data.lines.length });
  return data.lines;
}

// ── POST /v1/ai/chat ─────────────────────────────────────────────────────────
// Called by GeminiChatClient.kt. Matches MAX_TRANSCRIPT_CHARS on the native side.
const ChatBody = z.object({
  transcript: z.string().min(1).max(4000),
  tone: z.enum(['vibe', 'roast', 'comedy', '']).default(''),
});

ai.post('/chat', async (c) => {
  const { sub } = c.get('user');
  const body = ChatBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('transcript is required');
  const { transcript, tone } = body.data;

  const data = await charged(sub, async () => {
    const { data } = await generate<{ reply: string }>({
      engine: 'chat',
      system: chatPrompt(tone),
      parts: [{ text: `Here is the chat so far:\n\n${transcript}\n\nWrite the best reply for me to send.` }],
      schema: CHAT_SCHEMA,
      maxOutputTokens: 512,
    });
    return data;
  });

  const credits = await creditsFor(sub);
  // Flat shape: the Kotlin client reads `reply` off the top level.
  //
  // `remaining` is kept ALONGSIDE the standard envelope because
  // GeminiChatClient.kt parses `credits.optInt("remaining")`. That is native, so
  // dropping the key needs an app.json `version` bump and a rebuild, not an OTA —
  // and the accessibility service would silently read 0 credits until then.
  return c.json({
    reply: data.reply,
    credits: { ...creditsEnvelope(credits), remaining: credits.isPro ? null : credits.remaining },
  });
});
