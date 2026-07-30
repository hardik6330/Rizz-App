# RizzCoach — Production Backend Blueprint

Status: design. Third document in the set — read [profile-analyzer-blueprint.md](./profile-analyzer-blueprint.md)
for the native capture layer and [cto-report.md](./cto-report.md) for the strategic assessment.
This one covers only the server tier.

Designed against the actual codebase, not a template. Every decision below traces to something
in `src/` or `modules/profile-capture/`.

---

# Part 1 — What the client already is

Recorded here so the design can be checked against it, not to restate the CTO report.

| Layer | Reality | Consequence for the backend |
|---|---|---|
| Runtime | Expo SDK 57, RN 0.86, React 19, CNG (`/android`, `/ios` regenerated) | No manual native edits; client changes ship as OTA only if no native symbol changes |
| Navigation | Expo Router, 4 tabs + 3 stack modals | Irrelevant to the server |
| AI transport | **One** function: `callGemini<T>` in [gemini.ts](../src/services/gemini.ts) | **One** file to repoint at the proxy. The single most important property in this repo |
| Engines | `engine`, `bioEngine`, `profileEngine`, `feedEngine` — each = prompt + `responseSchema` + mock seeds | Prompts and schemas move server-side wholesale; mock seeds stay |
| **Second AI client** | `GeminiChatClient.kt` — blocking `HttpURLConnection`, own copy of the request shape | **Any backend that ignores this leaves the key on the device.** ~20 lines to repoint |
| State | Zustand + `persist` over MMKV | Client keeps an optimistic cache; server becomes truth |
| Limits | [limits.ts](../src/state/limits.ts) — pure, self-checked, `FREE_ANALYSIS_LIMIT=3` lifetime, `FREE_SWIPE_LIMIT=10`/day | These pure functions get a **second caller** on the server. Do not fork them |
| Billing | RevenueCat, entitlement `pro`, full mock mode | RevenueCat stays the source of truth. The server subscribes to its webhook |
| Identity | **None.** No account, no email. RevenueCat anonymous app-user-id + MMKV | The backend must be **anonymous-first**. See §5.1 |
| Secrets | `EXPO_PUBLIC_GEMINI_API_KEY` in the JS bundle **and** pushed into Android SharedPreferences by `configureChat` | The reason this document exists |
| Fallback | Every engine catches and returns mock seeds | Backend outage must degrade to mock, not to a crash — but must no longer be *silent* |

Two facts drive most of what follows:

1. **`callGemini` is the only JS network path, and `GeminiChatClient.kt` is the only other one.**
   Two files repoint the entire application. This is unusually cheap and it is the payoff of the
   "one transport" rule the client already follows.
2. **`feedEngine.generateFreshOpeners()` runs once per device per day.** Fifteen identical-purpose
   lines generated separately for every user. At 100k DAU that is 100k Gemini calls a day for
   content that could be one. This is the single largest cost defect in the product and the
   backend fixes it by existing.

---

# Part 2 — What moves, and what must not

The brief said not to move everything. Agreed — most of this app is correctly on-device.

## 2.1 Moves to the server

| Feature | Why | Impact |
|---|---|---|
| **All Gemini calls** (4 JS engines + Kotlin chat) | The key is extractable from the APK today. Unbounded financial liability, discoverable by automated scanners within days of release | **Security: critical.** Cost: enables every control below |
| **Prompts + `responseSchema`** | They are the only real moat and they currently ship in the bundle in plaintext. Server-side also means fixing a bad prompt without a store release | Moat + operational agility |
| **Credit ledger** | `analysisCount` lives in MMKV; a reinstall restores all three free credits. With real COGS that is an open tap | Cost + abuse |
| **Entitlement truth** | Client `isPro` is a boolean in MMKV that any modified build can set | Revenue integrity |
| **Daily feed generation** | N× duplicate work for identical content | **~99.999% cost reduction on this feature at scale** |
| **Usage + cost telemetry** | No visibility today; an app-wide outage was invisible once already | Operability |
| **Model choice, kill switch, flags** | `gemini-flash-latest` is a rolling alias that already broke the app once. You need to pin/repoint without a release | Resilience |

## 2.2 Stays on the device — deliberately

| Feature | Why it must not move |
|---|---|
| **Vault / `savedItems`** | It is the user's own saved text. Syncing it means *storing conversation content on a server*, which contradicts the disclosure in [analyzer.tsx](../src/app/analyzer.tsx). It has no server-side value until multi-device accounts exist. Keep it in MMKV |
| **Mock seeds** | Offline demo is a product property, and it is the graceful-degradation path when the backend is down |
| **`limits.ts` rules** | The *rule* stays pure and shared. The server enforces it; the client runs the same functions to predict the UI so the paywall appears instantly instead of after a round trip |
| **`ScreenClassifier` + capture** | Latency and privacy. Screen contents must never leave the device for *classification* — only after an explicit tap, and only the one screen |
| **Theme, layout, haptics, animation** | Obviously |
| **`hasOnboarded`, feedback thumbs** | Local until analytics ships; then send the event, not the state |

## 2.3 The one genuinely hard call: image handling

The image must reach Gemini. There is no way to run vision without it leaving the device, and the
privacy policy has to say so plainly. What we control is everything else:

- **Never stored.** Not in a bucket, not on disk, not in a log. Request body → validate → forward →
  drop. The client already follows this discipline natively (`CaptureStore` is memory-only, and
  `RizzAccessibilityService.encode()` goes bitmap → bytes → base64 with no file). The server keeps
  the property.
- **EXIF stripped on the client, before upload.** Gallery picks via `expo-image-picker` can carry
  GPS coordinates. The native capture path cannot (it encodes a fresh bitmap), but the gallery path
  can, and sending a user's home coordinates to a third party for no reason is indefensible. One
  `expo-image-manipulator` call on the client is cheaper and safer than decoding in a Worker.
- **Never cached for `them` mode.** See §7.4 — this is the sharpest privacy decision in the design.

---

# Part 3 — Architecture

Deliberately small. One deployable, one database, no microservices, no service mesh, no Kafka.
Every box below earns its place; anything I could not justify is in §3.3.

```
   RizzCoach app (JS)                    RizzAccessibilityService (Kotlin)
   src/services/gemini.ts                GeminiChatClient.kt
          │                                       │
          │  POST /v1/ai/*   Bearer <device JWT>  │
          └───────────────────┬───────────────────┘
                              ▼
              ┌─────────────────────────────────┐
              │  Hono API — Node container      │   ← ONE deployable
              │  Railway / Render / Fly         │
              │                                 │
              │  middleware chain:              │
              │    auth (JWT) → rate limit →    │
              │    validate → credit gate       │
              │                                 │
              │  routes:    /ai /user /feed /rc │
              │  scheduler: daily feed, cleanup │
              └───────┬───────────────────┬─────┘
                      │                   │
                      ▼                   ▼
             ┌──────────────────┐   ┌────────────────┐
             │  MySQL 8         │   │ Google Gemini  │
             │  (managed)       │   │ (server key)   │
             │                  │   └────────────────┘
             │  users           │
             │  daily_feed      │   optional: route via Cloudflare AI
             │  rc_events       │   Gateway for retries + cost logging
             └──────────────────┘
                      ▲
  RevenueCat webhook ─┘  POST /v1/rc/webhook (signature-verified, idempotent)
```

## 3.1 Request flow — a profile scan

1. Client checks its **local** `limits.ts` prediction. Out of credits → paywall, no request sent.
   (Latency win: the paywall is instant, exactly as it is today.)
2. `POST /v1/ai/profile` with `Authorization: Bearer <device JWT>`, body `{ images[], mode }`.
3. **Auth** — verify JWT signature, extract `user_id`, reject if expired.
4. **Rate limit** — per user (token bucket), per IP (coarse), global (circuit breaker).
5. **Validate** — magic-byte sniff, size cap, count cap, mode enum.
6. **Credit gate** — single conditional `UPDATE` (§6.3). Atomic. Fails closed.
7. **Cache lookup** — `self`/`bio`/`feed` only; never `them` (§7.4).
8. **AI gateway** → Gemini with the server-side key, using the prompt + schema for this engine.
9. **Response validated against the schema** before it leaves the server.
10. **Rejected work refunds the credit** — mirrors the client rule that `isProfile === false` must
    not charge (`profile.tsx` already does this locally; the server must too).
11. Write a `usage_events` row (tokens, latency, ok, cached — **never content**).
12. Return `{ result, credits: { remaining, isPro } }` so the client reconciles in one round trip.

## 3.2 Failure flow

Backend 5xx / timeout / offline → client catches → **mock seeds, exactly as today** → and now also
emits an `ai_fallback_mock` analytics event and a Crashlytics non-fatal. The degradation stays
graceful; it stops being invisible.

## 3.3 Services I considered and cut

| Not building | Why |
|---|---|
| Object storage (R2/S3) | We never store an image. Adding a bucket creates the exact liability the design avoids |
| Redis | One MySQL row per day is the feed cache, and it is read into process memory on boot. Redis is a second stateful thing to operate. It earns its place the day you run more than one API instance and need shared rate-limit counters — not before |
| A queue | The only async work is two scheduled jobs. A scheduler covers it; a broker is machinery for work that does not exist yet |
| Separate "AI service" | It is a `fetch` with a prompt. A network hop between two of your own services buys nothing and costs latency and a failure mode |
| Kubernetes / autoscaling groups | One container on a PaaS. There is nothing here that needs an orchestrator |
| GraphQL | Six endpoints. REST is smaller and the client's `fetch` already speaks it |
| Message broker (Kafka/SQS) | Two scheduled jobs. `node-cron` in the same process covers it |
| Separate analytics DB | Firebase Analytics (see the CTO report) handles product events; the AI gateway logs cost. Neither needs a warehouse yet |

---

# Part 4 — Stack selection

## 4.1 The workload, characterised

This is not a typical CRUD API and choosing as if it were would be wrong:

- **Few, large, slow requests.** ~1 MB base64 bodies; Gemini vision takes 3–15 s. The server is
  almost pure I/O wait — near-zero CPU per request.
- **Extremely spiky.** Consumer app, evening-heavy.
- **Tiny relational surface.** Users, usage, prompts, flags. No joins of consequence.
- **One engineer.** Operational cost is the dominant constraint, not throughput.
- **Cost control is the #1 requirement**, per the CTO report.

## 4.2 Comparison

**Backend framework**

| | Verdict |
|---|---|
| Express | Mature, but middleware-heavy and not edge-compatible. No |
| NestJS | Excellent for a team of ten with a large domain. Here it is DI ceremony around six endpoints. **Overengineering** |
| Fastify | Great on Node. Ties you to a Node runtime |
| **Hono** | **Chosen.** Tiny, TypeScript-first, runs on Workers *and* Node — so the runtime decision is reversible. Middleware model fits the auth→limit→validate→gate chain exactly |

**Database**

| | Verdict |
|---|---|
| MongoDB | The data is relational and small. No reason |
| Firebase/Firestore | Already using Firebase for analytics, but Firestore's pricing punishes counter writes, and credits are counter writes |
| Supabase | Good product. Postgres + auth we don't need (anonymous-first) + a second vendor |
| PostgreSQL | Technically the strongest of the three. Chosen against only because the team knows MySQL, and for a schema this small that is the deciding factor |
| Cloudflare D1 | SQLite; excellent *if* the API runs on Workers. Ruled out by the deployment choice below |
| **MySQL 8 (managed)** | **Chosen.** The workload is one table and one conditional `UPDATE` — no engine will ever be the bottleneck here, so operator familiarity wins. InnoDB row locking gives the credit gate its atomicity for free |

**ORM** — **Drizzle (mysql2 driver).** SQL-shaped, no engine binary, and migrations are plain SQL
files you can read before they run against production. Prisma would also work; Drizzle is lighter
and its generated SQL is legible, which matters for the credit gate in §6.3.

**Cache** — **none in v1.** The only cacheable thing is the daily feed: one MySQL row, read into
process memory on boot and on the cron tick. Redis earns its place the day you run a second API
instance and need shared rate-limit counters.

**Storage** — none (§3.3).

**Deployment**

| | Verdict |
|---|---|
| Vercel | Function timeouts historically collide with 15 s AI calls; needs care |
| AWS Lambda + API GW | Most powerful, most YAML. Wrong shape for one engineer |
| Cloudflare Workers | Cheapest and no cold start — but a raw MySQL connection behind short-lived isolates exhausts the pool. Would force PlanetScale's HTTP driver or Hyperdrive. Real friction for no gain here |
| **Railway / Render / Fly (container)** | **Chosen.** A long-running Node process: a normal connection pool, no timeout anxiety on a 15 s AI call, an in-process scheduler, and one runtime to reason about. Managed MySQL sits next to it on the same platform |

## 4.3 Final stack

```
Hono + TypeScript   on  Node 22, one container (Railway / Render / Fly)
Drizzle ORM         on  MySQL 8 (managed, same platform)
mysql2 pool         connectionLimit ~10
node-cron           in-process scheduler: daily feed, cleanup
Cloudflare AI Gateway (optional)  in front of Gemini — retries + per-model cost logging
Secrets: platform env vars (Gemini key, JWT signing key, RevenueCat webhook secret)
```

Two boxes. That is the whole production system, and it is deliberate: the interesting risk in this
project is the Gemini proxy and the credit gate, not the infrastructure.

**Why Hono still, on a container?** Because it keeps the decision reversible. The same `app` object
runs on Workers, Bun or Node behind a different entry file. If MySQL is ever swapped for D1, or the
container for an edge deploy, none of `routes/`, `middleware/` or `services/` changes.

**Cloudflare AI Gateway is worth keeping even off Cloudflare.** It is just a proxy URL you point at
instead of `generativelanguage.googleapis.com`, and it gives request logging, per-model cost
analytics and automatic retries for free. It is also a second place to repoint when
`gemini-flash-latest` rolls again — which, per AGENTS.md, has already broken this app once.

---

# Part 5 — Security

The threat model that matters: *this app transmits screenshots of other people's private
conversations.* Everything below is ranked by that.

## 5.1 Identity — anonymous-first, on purpose

**Do not add email/password signup.** This is a dating-confidence product; asking for an account
before the first analysis will destroy activation, and it creates a PII store you otherwise do not
have. Identity is a device, not a person.

```
1. First launch: client generates a UUIDv4 install_id → MMKV (added to `partialize`).
2. POST /v1/auth/device { install_id, platform, attestation? }
3. Server upserts a user row, returns:
      access  JWT (24 h, HS256, claims: sub=user_id, pro, exp)
      refresh token (opaque, 90 d, hashed at rest)
4. Every request: Authorization: Bearer <access>
5. 401 → client silently refreshes → retries once → else falls back to mock.
```

**Attestation, staged.** A JWT alone does not stop someone extracting the endpoint and minting
install IDs. The real defence is platform attestation — **Play Integrity** on Android, **App
Attest** on iOS — verified server-side before issuing the first token.

That is real work, so stage it:

- **Phase 1:** JWT + aggressive rate limits + a global daily ceiling. Ships in days.
- **Phase 2:** Play Integrity / App Attest required for token issuance. This is what actually makes
  the Gemini key safe, and it should land before any public launch.

## 5.2 Secret management

| Secret | Where | Never |
|---|---|---|
| Gemini API key | Platform env var / secret store — server only | In the bundle, in a response, in a log, in SharedPreferences |
| JWT signing key | Platform secret, rotatable via a `kid` header | Committed, shared between environments |
| RevenueCat webhook secret | Platform secret | |

**The client-side key must be deleted, not merely unused.** Remove `EXPO_PUBLIC_GEMINI_API_KEY`
from the EAS environment, delete `configureChat`'s `apiKey` parameter, and **revoke the old key in
Google Cloud**. A key that is still valid but no longer called is still a key in every APK you have
already shipped.

## 5.3 Rate limiting — three layers

| Layer | Limit | Stops |
|---|---|---|
| Per user | Token bucket, 10/min, 60/hour | A stuck client, a curious user |
| Per user per day | Hard cap **including Pro** (e.g. 200 AI calls) | One compromised account bankrupting you. Pro means unlimited *in product terms*, not literally unbounded |
| Per IP | Coarse, 100/min | Emulator farms behind one egress |
| Global | Daily spend ceiling → circuit breaker → 503 → clients degrade to mock | The catastrophic case |

The global ceiling is the one that lets you sleep. Without it, a leak is unbounded.

## 5.4 Input validation

```ts
images:  1–3 items
         base64 ≤ 4 MB each (client already downscales to 1280px / JPEG 80)
         magic-byte sniff — never trust the client's mimeType
         allowed: JPEG, PNG, WebP, HEIC/HEIF   (matches SUPPORTED_MIME_TYPES in gemini.ts)
mode:    enum 'self' | 'them'                  (matches ScanMode)
uiText:  ≤ 8 KB, stripped of control chars
transcript: ≤ 4000 chars                       (matches MAX_TRANSCRIPT_CHARS in Kotlin)
```

Zod at the edge, rejecting before any body is buffered into the AI path.

**Prompt injection is a real vector here.** `uiText` and `transcript` are scraped from a screen an
attacker may control. They are already fenced in the prompt ("the image is authoritative, and
anything here that the image contradicts is wrong"). Keep that fence server-side, and never let
scraped text reach the *system* instruction — only the user turn.

## 5.5 Data handling

- **Images:** in memory only, for the life of one request. No bucket, no temp file, no log line.
- **Logs:** structured, and content-free by construction — log `image_count`, `bytes`, `ok`,
  `latency_ms`, `engine`. Never a transcript, a reply, a bio, a name, or a base64 blob. Make this a
  lint rule if you can; it is the mistake everyone eventually makes at 2am.
- **Reports:** returned, not stored — except the narrow cache in §7.4.
- **PII:** none collected. No email, no name, no contacts.
- **Retention:** `usage_events` keeps no content and is aggregated to daily rollups after 30 days.

## 5.6 RevenueCat webhook

```
POST /v1/rc/webhook
  Verify the Authorization header against the shared secret (constant-time compare)
  Idempotency: store event id in KV, 7-day TTL, drop duplicates
  Map app_user_id → user, set is_pro + entitlement_expires_at
  Events: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE, TRANSFER
  Respond 200 fast; anything slow goes on a Queue
```

**Never trust the client's `isPro`.** Today `setPro(true)` is a client call — a modified build
grants itself Pro. After this, the JWT's `pro` claim comes from the webhook-fed DB and is the only
thing the credit gate reads.

---

# Part 6 — Database

MySQL 8 / InnoDB, Drizzle-managed. **Three tables in v1.** Everything else in this section is
listed as deferred with the condition that earns it — build them when that condition is true, not
before.

## 6.1 v1 schema — all of it

```sql
-- ── users ────────────────────────────────────────────────────────────────
-- Anonymous. One row per install. No PII, ever.
-- This is the ONLY table that is genuinely unavoidable: the whole point of a
-- server-side credit ledger is surviving the reinstall that resets MMKV.
CREATE TABLE users (
  id                     CHAR(36)     NOT NULL,
  install_id             CHAR(36)     NOT NULL,          -- client UUID, MMKV
  rc_app_user_id         VARCHAR(128) NULL,              -- RevenueCat anonymous id
  platform               ENUM('ios','android') NOT NULL,
  app_version            VARCHAR(24)  NULL,

  is_pro                 TINYINT(1)   NOT NULL DEFAULT 0,
  entitlement_expires_at BIGINT       NULL,              -- epoch ms, NULL = none/lifetime

  -- Mirrors state/limits.ts. Same rule, second caller — never a fork.
  analysis_count         INT UNSIGNED NOT NULL DEFAULT 0, -- lifetime free used
  daily_call_count       INT UNSIGNED NOT NULL DEFAULT 0, -- abuse cap, incl. Pro
  daily_call_date        DATE         NULL,

  banned_at              BIGINT       NULL,
  created_at             BIGINT       NOT NULL,
  updated_at             BIGINT       NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_install (install_id),
  UNIQUE KEY uq_users_rc      (rc_app_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── daily_feed ───────────────────────────────────────────────────────────
-- Generated ONCE per day, globally, replacing N× per-device generation.
-- The composite PK is also the job's idempotency guard: a double-fired cron
-- (two instances, a retry) hits a duplicate key and is a no-op.
CREATE TABLE daily_feed (
  feed_date  DATE              NOT NULL,
  version    SMALLINT UNSIGNED NOT NULL,   -- the vN tag discover.tsx already bumps
  items_json JSON              NOT NULL,
  created_at BIGINT            NOT NULL,
  PRIMARY KEY (feed_date, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── rc_events ────────────────────────────────────────────────────────────
-- Webhook idempotency only. RevenueCat retries; this makes replays free.
-- Rows older than 30 days are deleted by the nightly job.
CREATE TABLE rc_events (
  event_id   VARCHAR(128) NOT NULL,
  user_id    CHAR(36)     NULL,
  type       VARCHAR(48)  NOT NULL,
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (event_id),
  KEY idx_rc_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**One UTC trap worth naming.** `limits.ts::todayKey()` uses `toISOString().slice(0,10)`, i.e. UTC.
`daily_call_date` and `feed_date` must be computed in UTC too, or the client and server disagree
about when the day rolled and a user near midnight sees a limit that has "already reset" locally
but not on the server. Set the connection to `time_zone = '+00:00'` and never use `CURDATE()`.

## 6.2 Deferred tables, and what earns each one

| Table | Build it when | Until then |
|---|---|---|
| `usage_events` | You need **per-user** cost attribution or want to compare prompt versions | Cloudflare AI Gateway already logs tokens, latency and cost per call |
| `prompts` | You want A/B weights or to change a prompt without a deploy | A TypeScript file in the repo. `git push` → redeploy is ~60s, which already beats a store release — that was the actual benefit |
| `feature_flags` | You need per-cohort rollout | A JSON constant + an env var for the kill switch |
| `analyses` (score history) | The CTO report's §6.3 feature ships | Nothing. And when it does: store **scores and timestamps**, never report prose about a third party |

## 6.3 What is never in the database, in any phase

- **No images, transcripts, replies or reports.** By design, not omission.
- **No `saved_items`.** The vault stays in MMKV (§2.2).
- **No PII.** No email, no name, no contacts.
- **No swipe counters.** `FREE_SWIPE_LIMIT` gates a feed that is generated once globally and
  cached — swiping costs you nothing, so reinstalling to reset it causes no financial harm. It is a
  monetization nudge, not a cost control. Leave it in MMKV exactly as it is today.

If this database leaked tomorrow, an attacker would learn that some anonymous install has used two
of its three free credits.

## 6.4 The credit gate — one atomic statement

The correctness trap: a user double-taps, two requests read `analysis_count = 2` concurrently, both
see a credit, both proceed. Solved with a conditional `UPDATE`, not a transaction or an app-level
lock — InnoDB takes the row lock and `affectedRows` tells you who won:

```sql
UPDATE users
   SET analysis_count   = analysis_count + 1,
       daily_call_count = IF(daily_call_date = ?today, daily_call_count + 1, 1),
       daily_call_date  = ?today,
       updated_at       = ?now
 WHERE id = ?userId
   AND banned_at IS NULL
   AND (is_pro = 1 OR analysis_count < ?FREE_ANALYSIS_LIMIT)
   AND (daily_call_date <> ?today OR daily_call_count < ?DAILY_CAP);
-- affectedRows = 0 → 402 Payment Required. Fails closed.
```

`FREE_ANALYSIS_LIMIT` is returned to the client in every response, so the constant has exactly one
definition — which is what [constants.ts](../src/constants.ts) becomes.

**Refund on rejection.** When `isProfile === false`, decrement in the same request. `profile.tsx`
already implements this rule locally; the server must match it or the two disagree about the
balance.

> `limits.ts` moves to a shared workspace package imported by both the app and the API. Same file,
> same self-check, two callers. Forking it is how the original swipe-allowance bug happens again.

## 6.5 Connections and migrations

- **Pool:** `mysql2/promise` pool, `connectionLimit: 10`, `enableKeepAlive: true`. One container
  means one pool; sizing is a non-problem until §10's 100k row.
- **Migrations:** Drizzle Kit (`mysql` dialect), forward-only, numbered SQL in `migrations/`,
  applied in CI *before* the new image goes live. Expand → backfill → contract for anything
  destructive. Never edit a shipped migration.
- **Backups:** whatever the managed provider gives you, verified by an actual restore once. An
  untested backup is not a backup.

# Part 7 — AI infrastructure

## 7.1 The gateway

One module, `src/ai/gateway.ts`, that is the server-side twin of `callGemini`:

```ts
export async function generate<T>(opts: {
  key: PromptKey;              // 'profile.them' | 'lab.rizz' | ...
  parts: GeminiPart[];
  userId: string;
  overrides?: { temperature?: number };
}): Promise<{ data: T; usage: Usage; cached: boolean }>
```

It resolves the prompt row (with A/B weighting), calls Gemini through Cloudflare AI Gateway,
validates the response against the stored schema, records usage, and throws on failure. Every
engine route is then ~15 lines. **Adding a fifth engine is one row in `prompts` and one route** —
which preserves the property the client already has.

## 7.2 Prompt management and versioning

Prompts live in the API repo (a `prompts/` module; a table only when §6.2's condition is met) and are lifted verbatim from the current files —
[engine.ts](../src/services/engine.ts)'s `PROMPT_SECTIONS`,
[profileEngine.ts](../src/services/profileEngine.ts)'s `SELF_PROMPT`/`THEM_PROMPT`,
[bioEngine.ts](../src/services/bioEngine.ts), [feedEngine.ts](../src/services/feedEngine.ts), and
`GeminiChatClient.kt`'s `SYSTEM`. They are excellent; they are moving, not being rewritten.

**The `them`-mode HARD RULES block moves verbatim.** It is the safety rail *and* the review
defence, and it must never be A/B tested away. Enforce that with a startup assertion that the
active `profile.them` prompt contains its required clauses.

`prompt_version` on every `usage_events` row means you can answer "did the new prompt make things
worse" — impossible today.

## 7.3 Model strategy and the rolling alias

`gemini-flash-latest` moved to Gemini 3 and broke every call in the app with a 400. The `model`
column exists so the fix is a database update, not a store release. Pin explicitly in production;
canary the alias on a small `weight` before promoting.

`thinking_level` is a column for the same reason — it is load-bearing, it changed once already, and
it must be changeable without shipping a binary.

## 7.4 Caching — and the one place it must not apply

| Content | Cache | Key | TTL |
|---|---|---|---|
| Daily feed | **Yes** | `daily_feed` row, held in process memory | until the next cron tick |
| Bio optimize | Yes | `sha256(interests+vibe+currentBio)` | 24 h |
| Profile scan, `self` | Yes | `sha256(image bytes + mode + prompt_version)` | 24 h |
| **Profile scan, `them`** | **No** | — | — |
| Chat reply | **No** | — | — |

**Why `them` is not cached.** A `them` report is AI-generated commentary about a real person who
never consented. Caching it means storing that commentary server-side, keyed by a hash of their
photo — a lookup table from someone's face to a paragraph about them. That is a materially
different product from "a proxy that forwards and forgets", and it is not one I would defend in a
privacy review. The cost saving is not worth it. Same reasoning for chat replies: they are derived
from private conversation content.

This is the kind of decision that is very cheap to make now and very expensive to unwind later.

## 7.5 Retry, fallback, cost tracking

- **Retry:** once, on 5xx/429/timeout, with jitter. Never on 400 — that is the `thinkingLevel`
  class of bug and retrying it just triples a guaranteed failure.
- **Fallback chain:** pinned model → alias → 503. The client's mock seeds are the last tier and stay
  where they are.
- **Cost:** every call writes `prompt_tokens` / `output_tokens` / `thought_tokens` from Gemini's
  `usageMetadata`. AGENTS.md already insists on measuring `usageMetadata` before changing a cap;
  this makes that a query rather than an experiment.

Structurally, an analysis is roughly *one 1280px image (~1–2k tokens) + prompt (~0.5–1.5k) + output
(~0.3–0.8k)*. Images dominate. That is why the client's existing downscale-to-1280/JPEG-80 in
`RizzAccessibilityService.encode()` is a cost control, not just a bandwidth one — keep it, and
apply the same to gallery picks. Plug current Gemini pricing into that shape rather than trusting
any number quoted here.

---

# Part 8 — API

Base `https://api.rizzcoach.app/v1`. JSON. Bearer auth except where noted.

### `POST /auth/device` — no auth
```
→ { install_id, platform, app_version, attestation? }
← { access_token, refresh_token, expires_in, user: { is_pro, credits_remaining, limits } }
429 per IP. 403 if attestation fails (Phase 2).
```

### `POST /auth/refresh` — no auth
```
→ { refresh_token }   ← { access_token, expires_in }
```

### `POST /ai/lab`
```
→ { image: base64, mime_type, mode: 'rizz'|'vibe'|'roast', temperature? }
← { result: AnalysisResult, credits: { remaining, is_pro } }
Charges 1 credit on the first success per image (client sends an idempotency key so
mode-switching and rerolls stay free — mirrors `charged.current` in index.tsx).
402 out of credits · 400 invalid image · 429 · 503 AI unavailable
```

### `POST /ai/profile`
```
→ { images: base64[1..3], mime_types[], mode: 'self'|'them', ui_text? }
← { result: ProfileScanResult, credits }
Refunds the credit when isProfile === false.
```

### `POST /ai/bio`
```
→ { interests: string[1..12], vibe, current_bio? }   ← { result: BioResult, credits }
```

### `POST /ai/chat` — **called by `GeminiChatClient.kt`**
```
→ { transcript: string ≤4000, tone: 'vibe'|'roast'|'comedy'|'' }
← { reply: string, credits }
The Kotlin change is: swap the URL, swap x-goog-api-key for Authorization: Bearer,
and read `reply` off the top level instead of parsing candidates[]. ~20 lines.
```

### `GET /feed?date=YYYY-MM-DD&v=3` — auth optional
```
← { date, version, items: FeedItem[] }
Served from KV. Never generated per request — see §9.1.
```

### `GET /user/credits`
```
← { is_pro, analysis_count, credits_remaining, swipes_used_today,
    limits: { free_analysis: 3, free_swipe: 10 } }
The client reconciles MMKV against this on launch and resume — the same place
_layout.tsx already runs `consumeChatUsage()`.
```

### `POST /user/swipe`
```
→ { count }   ← { swipes_used_today, locked }
Batched, not per swipe. The daily reset uses limits.ts::nextSwipeState server-side.
```

### `POST /rc/webhook` — RevenueCat only, signature-verified, idempotent (§5.6)

### `GET /config` — auth optional
```
← { flags, min_supported_version, ai_enabled }
`ai_enabled: false` is the global kill switch; clients degrade to mock.
```

**Error envelope**, uniform:
```json
{ "error": { "code": "OUT_OF_CREDITS", "message": "…", "retryable": false } }
```

---

# Part 9 — Background systems

Two scheduled jobs, in-process via `node-cron`. No broker, no worker fleet.

## 9.1 Daily feed — the big cost win

```
03:00 UTC daily
  → generate(BATCH_SIZE=15) once, globally
  → validate against the schema, drop anything failing the safety rules
  → INSERT IGNORE INTO daily_feed (feed_date, version, …)
  → refresh the in-process cache
  → on failure: retry ×3 with backoff; then serve yesterday's row and alert
Clients GET /feed and cache it locally under the same YYYY-MM-DD:vN tag they already use.
```

The composite primary key `(feed_date, version)` is the idempotency guard. If you ever run two API
instances, both fire the cron, and the second one's `INSERT IGNORE` is a no-op — so scaling out
does not need a distributed lock or a leader election.

Per-device generation goes from *N calls/day* to *1 call/day*. `feedEngine.ts` keeps its mock lines
for the offline path; the live path becomes a fetch.

## 9.2 Aggregation and cleanup

```
04:00 UTC  → delete rc_events older than 30 days
hourly     → set is_pro = 0 where entitlement_expires_at < now  (webhook safety net)
```

That is the entire background system in v1. The usage-aggregation job arrives with the
`usage_events` table (§6.2), not before.

## 9.3 Failure policy

Idempotent jobs (a date key, an event id). Retry ×3 with exponential backoff, then dead-letter and
alert. **A failed feed job must never leave the endpoint empty** — serve the previous day rather
than nothing, because `discover.tsx` treats an empty response as "use the curated set", which is a
silently worse product.

---

# Part 10 — Scaling

| Users | Shape | What changes |
|---|---|---|
| **1k** | One small container, smallest managed MySQL, ~1 AI call/user/day | Nothing. Roughly $10–20/month all-in |
| **10k** | Same shape | Turn on the response cache (§7.4). Watch the AI Gateway cost dashboard daily |
| **100k** | Two or more API instances behind the platform load balancer | Rate-limit counters move from process memory to **Redis** — the first moment it earns its place. Add a **read replica** and serve `GET /feed` and `GET /user/credits` from it. Bump the pool per instance |
| **1M** | MySQL writes are the thing to watch, not reads | `usage_events` (if built) is partitioned by month and rolled up nightly. `users` stays small — it is one narrow row per install, so even 1M rows is a few hundred MB. Vertical scaling carries you a long way; Vitess/PlanetScale sharding is the exit if it does not |

**Cost control scales differently from traffic**, and it is the one that will actually hurt:

1. Daily feed generated once, globally — the largest single saving (§9.1).
2. Cache `self`/`bio` (§7.4).
3. Per-user daily hard cap *including Pro* — one account cannot run away.
4. Global daily ceiling + kill switch — a leak cannot be unbounded.
5. Keep images at 1280px. Image tokens dominate every request.
6. Keep `thinking_level: low`. AGENTS.md documents that raising `maxOutputTokens` buys more
   thinking for an identical answer — that finding is a cost control and it belongs in the
   `prompts` row.

---

# Part 11 — Repository layout

A sibling folder in this repo, sharing `limits.ts` and the types through a workspace package.

```
backend/
├── src/
│   ├── index.ts              Hono app; route mounting; nothing else
│   ├── routes/               one file per resource — thin. Parse → call service → respond
│   │   ├── auth.ts  ai.ts  feed.ts  user.ts  revenuecat.ts  config.ts
│   ├── middleware/           the request chain, in order
│   │   ├── auth.ts           JWT verify → context.user
│   │   ├── rateLimit.ts      per-user / per-IP / global
│   │   ├── validate.ts       Zod schemas, incl. magic-byte image sniff
│   │   └── credits.ts        the atomic gate (§6.3) + refund helper
│   ├── ai/
│   │   ├── gateway.ts        the ONE Gemini path. Server twin of callGemini
│   │   ├── prompts.ts        load + A/B select + safety-clause assertion
│   │   └── schemas.ts        response schemas, seeded from the client engines
│   ├── services/             business logic. Routes stay dumb
│   │   ├── credits.ts  entitlements.ts  feed.ts  usage.ts
│   ├── db/
│   │   ├── schema.ts         Drizzle (mysql-core)
│   │   ├── client.ts         mysql2 pool, time_zone '+00:00'
│   │   └── migrations/       forward-only SQL
│   ├── jobs/                 scheduled handlers: generateFeed, cleanup, expireEntitlements
│   ├── lib/                  logger (content-free by construction), errors, crypto
│   └── types/                shared response types re-exported to the app
├── packages/limits/          ← the EXISTING src/state/limits.ts, promoted. One rule, two callers
├── test/                     Vitest + testcontainers (real MySQL, not a mock)
└── drizzle.config.ts
                              (deploy config is render.yaml, at the repo root —
                               the build needs packages/limits/ in scope)
```

Rules that keep it small: routes never touch the DB directly; `ai/gateway.ts` is the only file that
knows Gemini exists; `lib/logger.ts` is the only file that writes logs, and it takes a typed event,
not a string — which is how "never log content" stays true after the tenth engineer.

---

# Part 12 — Roadmap

### Phase 1 — Secure the AI path *(1 week — do this before anything else)*
Hono container + managed MySQL (the `users` table only), device auth (JWT), rate limits, `/ai/*`
for all four engines, prompts lifted into a module, global kill switch. Repoint `gemini.ts` (one file) and `GeminiChatClient.kt` (~20 lines).
Delete `EXPO_PUBLIC_GEMINI_API_KEY` from EAS and **revoke the old key**.
*Native change → bump `version`, rebuild.* **Priority: critical. Nothing else matters until the key
is off the device.**

### Phase 2 — Credits *(3 days)*
`users` + the atomic gate; `/user/credits`; refund-on-rejection; promote `limits.ts` to a shared
package. Client keeps MMKV as an optimistic cache and reconciles on resume.
*Closes the reinstall-resets-credits hole.*

### Phase 3 — Entitlements *(3 days)*
RevenueCat webhook, idempotency, `pro` in the JWT claim, expiry sweeper. Ship the `goog_` key at the
same time — Android currently grants Pro free.
*This is where revenue integrity starts.*

### Phase 4 — Daily feed *(3 days)*
Cron generation, KV serve, `/feed`. Client `feedEngine` becomes a fetch with a mock fallback.
*Largest single COGS reduction; do it before any growth push.*

### Phase 5 — Attestation + abuse *(1 week)*
Play Integrity / App Attest gating token issuance, ban list, anomaly alerts.
*Required before a public launch, not before a beta.*

### Phase 6 — Cost + prompt ops *(1 week)*
`usage_events` aggregation, a daily cost dashboard, prompt A/B via `weight`, model pinning.
*Turns prompt quality from an opinion into a measurement.*

### Phase 7 — Product surface *(ongoing)*
Score history, thread memory (CTO report §6.1), server-driven config. **Only now** does a
`analyses` table make sense — and it stores scores and timestamps, not prose about third parties.

---

# Appendix — Client changes required

Small, by design. This is what the "one transport" rule bought you.

| File | Change |
|---|---|
| [src/services/gemini.ts](../src/services/gemini.ts) | `callGemini` posts to `/v1/ai/*` with a Bearer token instead of Gemini with `x-goog-api-key`. Signature unchanged, so all four engines are untouched |
| The four engines | Remove the inlined prompts and schemas (now server-side). **Keep every mock seed** |
| `GeminiChatClient.kt` | Swap URL + auth header; read `reply` from the top level. ~20 lines |
| `ChatEntitlement.kt` | Drop `apiKey` entirely. The `isPro`/`freeRemaining` snapshot contract stays — it is still correct, just now seeded from the server |
| [src/state/useRizzStore.ts](../src/state/useRizzStore.ts) | Add `installId` + tokens to `partialize`; reconcile credits from `/user/credits` on resume, beside the existing `consumeChatUsage()` call in `_layout.tsx` |
| [src/state/limits.ts](../src/state/limits.ts) | Move to `packages/limits`. Same file, same self-check, two importers |
| [src/services/feedEngine.ts](../src/services/feedEngine.ts) | Live path becomes `GET /feed`. Mock lines stay |
| [app.json](../app.json) / EAS env | Remove the Gemini key. Add `EXPO_PUBLIC_API_URL` |

Nothing in `src/components/`, `src/theme/` or any screen changes. That is the measure of whether
this design respected the existing architecture.
