import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { generate, imagePart } from '../ai/gateway.ts';
import {
  BIO_PROMPT,
  COACH_APPS,
  COACH_STRUGGLES,
  COACH_STYLES,
  FEED_PROMPT,
  PROFILE_PROMPTS,
  chatPrompt,
  coachParts,
  labPrompt,
} from '../ai/prompts.ts';
import { BIO_SCHEMA, CHAT_SCHEMA, FEED_SCHEMA, PROFILE_SCHEMA, labSchema } from '../ai/schemas.ts';
import { db } from '../db/client.ts';
import { Errors } from '../lib/errors.ts';
import { todayKey } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';
import {
  chargeCredit,
  creditsEnvelope,
  creditsFrom,
  refundCredit,
  type CreditState,
} from '../middleware/credits.ts';

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

/**
 * The balance after this request, WITHOUT asking the database again.
 *
 * `requireAuth` has already read the row — `is_pro` and `analysis_count` are
 * sitting on the context — and a charge moves the count by exactly one. So the
 * SELECT that used to sit here was re-reading a number this request had just
 * written, on a pool with `connectionLimit: 1`, after the Gemini call the user
 * is already waiting on. `delta` is 1 for a charge that stuck and 0 for one that
 * was charged and refunded (`not_a_profile`).
 *
 * **The gate does not read this.** `chargeCredit` is still a single conditional
 * UPDATE against the live row, so nothing here can hand out a free analysis. The
 * only exposure is display: two requests racing from the same account both read
 * the pre-charge count, so one response can show a meter one behind. It is
 * correct again on the next request, and `/v1/user/credits` — which the app
 * calls on every launch and resume — is still authoritative.
 */
function creditsAfter(c: { get: (k: 'credits') => { isPro: boolean; analysisCount: number } }, delta: 0 | 1): CreditState {
  const { isPro, analysisCount } = c.get('credits');
  return creditsFrom(isPro, analysisCount + delta);
}

function withCredits(c: Parameters<typeof creditsAfter>[0], result: unknown, delta: 0 | 1 = 1) {
  return { result, credits: creditsEnvelope(creditsAfter(c, delta)) };
}

/**
 * The onboarding answers, optional on every engine.
 *
 * Closed enums, not strings — see the note on `coachParts` in ai/prompts.ts.
 * Anything the client sends that is not on these lists is dropped by zod before
 * it can reach a prompt, so an old build sending a since-renamed value degrades
 * to "no preferences" rather than 400ing a paying user's analysis.
 */
const Coach = z
  .object({
    apps: z.array(z.enum(COACH_APPS)).max(COACH_APPS.length).optional(),
    struggle: z.enum(COACH_STRUGGLES).optional(),
    style: z.enum(COACH_STYLES).optional(),
  })
  .optional()
  .catch(undefined);

/**
 * Remember the answers on the account, so they survive a reinstall and so
 * `/v1/ai/chat` — whose caller is native and cannot send them — has something to
 * read. See migration 0010.
 *
 * Opportunistic: written as a side effect of the requests that already carry it,
 * rather than by an endpoint the client has to remember to call. Three engines
 * send it on every analysis, so the row converges on the truth without a sync
 * protocol, and a user who changes an answer has it stored again on their next
 * analysis.
 *
 * The `<>` predicate is what keeps this from being a write per request: the
 * answers change roughly never, so after the first one MySQL matches no rows and
 * does no work. And it NEVER fails the request — a personalisation that did not
 * persist is not a reason to lose an analysis the user has already been charged
 * for, so the error is logged and swallowed.
 */
async function rememberCoach(userId: string, coach: unknown): Promise<void> {
  if (!coach) return;
  const json = JSON.stringify(coach);
  // The column is VARCHAR(255) and the enums cannot reach it — but a silent
  // truncation would store JSON that no longer parses, so bail rather than write.
  if (json.length > 255) return;
  await db
    .execute(sql`
      UPDATE users SET coach_json = ${json}
       WHERE id = ${userId} AND (coach_json IS NULL OR coach_json <> ${json})
    `)
    .catch((err) => log.error('coach.save_failed', err));
}

/**
 * The stored answers, validated. For the engines whose caller cannot send them.
 *
 * Re-validated against the same zod enums as the wire input rather than trusted:
 * the row was written by an earlier build of the app, and a value that has since
 * been renamed must degrade to "no preferences" instead of reaching a prompt as
 * a string nothing maps. `Coach` carries `.catch(undefined)`, so the only thing
 * that can throw here is `JSON.parse`.
 */
function storedCoach(raw: string | null): z.infer<typeof Coach> {
  if (!raw) return undefined;
  try {
    return Coach.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

// ── POST /v1/ai/lab ──────────────────────────────────────────────────────────
const LabBody = z.object({
  image: Image,
  mode: z.enum(['rizz', 'vibe', 'roast']),
  temperature: z.number().min(0).max(2).optional(),
  coach: Coach,
});

ai.post('/lab', async (c) => {
  const { sub } = c.get('user');
  const body = LabBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('image and mode are required');
  const { image, mode, temperature, coach } = body.data;
  await rememberCoach(sub, coach);

  const data = await charged(sub, async () => {
    const { data } = await generate<Record<string, unknown>>({
      engine: `lab.${mode}`,
      system: labPrompt(mode),
      parts: [
        ...validImages([image]),
        { text: 'Analyze this chat screenshot and return the RizzCoach breakdown.' },
        ...coachParts(coach),
      ],
      schema: labSchema(mode),
      temperature,
    });
    return data;
  });

  return c.json(withCredits(c, data));
});

// ── POST /v1/ai/profile ──────────────────────────────────────────────────────
const ProfileBody = z.object({
  images: z.array(Image).min(1).max(3),
  mode: z.enum(['self', 'them']),
  ui_text: z.string().max(8192).optional(),
  coach: Coach,
});

ai.post('/profile', async (c) => {
  const { sub } = c.get('user');
  const body = ProfileBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('images[1..3] and mode are required');
  const { images, mode, ui_text, coach } = body.data;

  const shots = images.length > 1 ? `these ${images.length} screenshots` : 'this screenshot';
  await rememberCoach(sub, coach);

  await chargeCredit(sub);
  let data: { isProfile: boolean; id?: string; profileName?: string };
  try {
    ({ data } = await generate<{ isProfile: boolean; id?: string; profileName?: string }>({
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
        ...coachParts(coach),
      ],
      schema: PROFILE_SCHEMA,
      temperature: 0.85,
    }));
  } catch (err) {
    await refundCredit(sub, 'generation_failed');
    throw err;
  }

  // Rejected work does not burn a credit — mirrors profile.tsx. The refund is
  // why this passes delta 0: charged then given back nets to no movement.
  if (!data.isProfile) {
    await refundCredit(sub, 'not_a_profile');
  } else {
    // Save scan summary to profile_scans (no raw images persisted)
    const scanId = data.id ?? `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    data.id = scanId;
    const title = data.profileName ? `${data.profileName}'s Profile` : `${mode === 'self' ? 'My' : 'Target'} Profile Scan`;
    await db.execute(sql`
      INSERT INTO profile_scans (id, user_id, mode, title, summary_json, created_at)
      VALUES (${scanId}, ${sub}, ${mode}, ${title}, ${JSON.stringify(data)}, ${Date.now()})
    `).catch((err) => log.error('profile_scan.save_failed', err));
  }

  return c.json(withCredits(c, data, data.isProfile ? 1 : 0));
});

// ── POST /v1/ai/bio ──────────────────────────────────────────────────────────
const BioBody = z.object({
  interests: z.array(z.string().max(64)).min(1).max(12),
  vibe: z.enum(['Funny', 'Sarcastic', 'Chill', 'Ambitious']),
  current_bio: z.string().max(2000).optional(),
  coach: Coach,
});

ai.post('/bio', async (c) => {
  const { sub } = c.get('user');
  const body = BioBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('interests and vibe are required');
  const { interests, vibe, current_bio, coach } = body.data;
  await rememberCoach(sub, coach);

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
        ...coachParts(coach),
      ],
      schema: BIO_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 1.0,
    });
    return data;
  });

  return c.json(withCredits(c, data));
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
 * `generateFeed` then collapses it ACROSS instances with a row claim — see the
 * comment there. Two layers because they solve different halves: `inFlight` is
 * free and handles the many concurrent requests one instance is serving, and the
 * claim costs one INSERT and handles the N instances Vercel decided to start.
 */
let inFlight: { date: string; work: Promise<unknown[]> } | null = null;

ai.post('/feed', async (c) => {
  const today = todayKey();

  const cached = await readFeed(today);
  if (cached) return c.json({ result: { lines: cached }, cached: true });

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

/** Today's batch if some other instance has finished writing it, else null. */
async function readFeed(today: string): Promise<unknown[] | null> {
  const rows = await db.execute(sql`
    SELECT items_json FROM daily_feed
     WHERE feed_date = ${today} AND version = ${FEED_VERSION} LIMIT 1
  `);
  const row = (rows as unknown as [Array<{ items_json: unknown[] }>])[0]?.[0];
  return row?.items_json ?? null;
}

/** How long a loser waits for the winner's row before giving up and generating. */
const CLAIM_WAIT_MS = 20_000;
const CLAIM_POLL_MS = 1_000;

async function generateFeed(today: string): Promise<unknown[]> {
  /*
   * Claim the day's generation across ALL instances, not just this one.
   *
   * `inFlight` above stops one instance buying the batch twice. It cannot stop
   * ten instances buying it ten times, because a module-level variable is
   * per-process and Vercel starts as many processes as it likes — so at 00:00
   * UTC every warm instance missed the cache together and each paid for its own
   * 4096-token generation, all but one of them thrown away by the INSERT IGNORE
   * below. That is a real bill for an identical answer.
   *
   * The claim reuses the `idempotency` table rather than adding one. It is
   * already exactly this: a keyed, INSERT IGNORE claim with a retention sweep,
   * and its ids are `<uuid>:<key>` so a `feed:` prefix cannot collide. Its 15
   * minute retention is also the right lease — far longer than a generation, far
   * shorter than a day, so a claim orphaned by a killed process clears itself.
   *
   * A MySQL GET_LOCK would be the textbook answer and is not available: the lock
   * is connection-scoped and this pool runs `connectionLimit: 1` on Vercel, so
   * holding one and then querying inside it deadlocks the instance.
   */
  const claimId = `feed:${today}:${FEED_VERSION}`;
  let won = true;
  try {
    const [claim] = await db.execute(sql`
      INSERT IGNORE INTO idempotency (id, status, body, created_at)
      VALUES (${claimId}, 0, NULL, ${Date.now()})
    `);
    won = (claim as { affectedRows: number }).affectedRows > 0;
  } catch (err) {
    // Fail OPEN, like every other claim in this service. A database blip must
    // not take Discover down; the cost of proceeding is the duplicate call this
    // exists to avoid, which is what happened every day before it existed.
    log.error('feed.claim', err);
  }

  if (!won) {
    /*
     * Someone else is generating. Wait for their answer instead of buying our
     * own — the whole point of the claim.
     *
     * ponytail: polling, not a notification. A 1s poll against a two-column
     * primary-key lookup is cheap, and the alternatives (LISTEN/NOTIFY, a queue)
     * are infrastructure for one row a day. It gives up after 20s and generates
     * anyway, so the worst case is exactly the old behaviour and never worse.
     */
    for (let waited = 0; waited < CLAIM_WAIT_MS; waited += CLAIM_POLL_MS) {
      await new Promise((r) => setTimeout(r, CLAIM_POLL_MS));
      const lines = await readFeed(today);
      if (lines) return lines;
    }
    log.warn('feed.claim_timeout', { date: today });
  }

  let data: { lines: unknown[] };
  try {
    ({ data } = await generate<{ lines: unknown[] }>({
      engine: 'feed',
      system: FEED_PROMPT,
      parts: [{ text: "Write today's fresh lines." }],
      schema: FEED_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 1.1,
    }));
  } catch (err) {
    // Release the claim so the next request retries rather than polling a
    // generation that is never coming. Same reasoning as the webhook claim.
    await db.execute(sql`DELETE FROM idempotency WHERE id = ${claimId}`).catch(() => {});
    throw err;
  }

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

  /*
   * The ONE engine that reads the answers from the row instead of the body.
   *
   * `GeminiChatClient.kt` posts `transcript` and `tone` and nothing else, and it
   * cannot reach the store to learn more — so this is the whole reason
   * `coach_json` is a column rather than a value the client keeps to itself.
   * It costs nothing here: `requireAuth` already read the row.
   *
   * It also means the bubble — the surface that writes an entire message on its
   * own, with no chance for the user to pick between options — personalises on a
   * deploy rather than on a store release.
   */
  const coach = storedCoach(c.get('coachJson'));

  const data = await charged(sub, async () => {
    const { data } = await generate<{ reply: string }>({
      engine: 'chat',
      system: chatPrompt(tone),
      parts: [
        { text: `Here is the chat so far:\n\n${transcript}\n\nWrite the best reply for me to send.` },
        ...coachParts(coach),
      ],
      schema: CHAT_SCHEMA,
      maxOutputTokens: 512,
    });
    return data;
  });

  const credits = creditsAfter(c, 1);
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
