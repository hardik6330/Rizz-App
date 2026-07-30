# RizzCoach API

Phase 1 of [docs/backend-blueprint.md](../docs/backend-blueprint.md): get the Gemini key off the
device.

## Why this exists

`EXPO_PUBLIC_GEMINI_API_KEY` is embedded in the JS bundle **and** pushed into Android
SharedPreferences by `configureChat`. Anyone who unzips the APK has it, and there is no server-side
quota — so the exposure is an open-ended bill, not a bounded one.

## Run

```bash
cp .env.example .env      # fill GEMINI_API_KEY, JWT_SECRET, DATABASE_URL
npm install
npm run db:migrate        # or: mysql < src/db/migrations/0000_init.sql
npm run dev
```

### TLS to a managed database

Aiven / PlanetScale / DO sign their MySQL certs with a **per-project CA that Node does not
trust**, so a correct config still fails with `HANDSHAKE_SSL_ERROR`. Download the CA from the
provider console (Aiven: service → *CA certificate* → download), save it as `backend/ca.pem`
(gitignored) and point `DATABASE_CA` at it.

The tempting fix is `rejectUnauthorized: false`. Don't — every row on this connection is a
credit balance or a purchase state, crossing the public internet to a managed host, and an
unverified peer is a silent MITM. `src/db/client.ts` keeps verification on in both branches.

```bash
# smoke test
curl -s localhost:8787/healthz
TOKEN=$(curl -s localhost:8787/v1/auth/device \
  -H 'content-type: application/json' \
  -d '{"install_id":"11111111-1111-4111-8111-111111111111","platform":"android"}' \
  | jq -r .access_token)
curl -s localhost:8787/v1/user/credits -H "Authorization: Bearer $TOKEN" | jq
```

## Shape

| Path | Notes |
|---|---|
| `src/ai/gateway.ts` | The **only** file that talks to Gemini. `thinkingLevel: 'low'` is load-bearing |
| `src/ai/prompts.ts` | Every system prompt, lifted verbatim from the client. `assertSafetyRails()` refuses to boot without the `them`-mode HARD RULES block |
| `src/middleware/credits.ts` | The atomic gate. One conditional `UPDATE`, fails closed |
| `src/lib/limits.ts` | **Re-exports** `src/state/limits.ts`. One rule, two callers — never a fork |
| `src/lib/logger.ts` | Takes a typed event, not a string, so a transcript has nowhere to leak into |

## Rules

- **Never log content.** No base64, transcripts, replies, bios, names or `ui_text`.
- **Never store an image.** Request body → validate → forward → drop. There is no bucket.
- **Never trust the client's mime type.** `sniff()` in `routes/ai.ts` reads magic bytes.
- **Never trust the client's `isPro`.** It comes from the JWT, which comes from the DB.

## Deploy

No Docker. Two targets are configured, both from the **repo root** — never with the project
root set to `backend/`, because `lib/limits.ts` re-exports the app's `src/state/limits.ts` and
that file is outside `backend/`.

### Vercel — `vercel.json` + `api/index.ts`

Import the repo, leave Root Directory as `./`, add the env vars below, deploy. `installCommand`
only installs `backend/`, so the root Expo dependencies are never touched.

Four things are load-bearing:

| | Why |
|---|---|
| `@hono/node-server/vercel`, not `hono/vercel` | The latter selects the Edge runtime, which has no TCP sockets, so mysql2 cannot reach Aiven at all |
| `maxDuration: 60` | Must stay **above** the 45s `AbortSignal.timeout` in `ai/gateway.ts`. Serverless has no SIGTERM, so that abort is the only thing that still lets `charged()` refund. Vercel's default is 10s and Hobby caps at 60s — a 3–15s Gemini call needs the headroom |
| `connectionLimit: 1` when `process.env.VERCEL` | Every warm instance gets its own pool; Aiven's small plans cap `max_connections` in the low tens |
| The catch-all rewrite | Vercel preserves the original URL through a rewrite into a function, so Hono still sees `/v1/…` and needs no `basePath()` |

Accepted costs: `rateLimit` becomes per-instance and effectively off (the per-day cap in
`middleware/credits.ts` is in the database and still holds the Gemini bill); and an unreachable
database surfaces as live 500s instead of the failed deploy that `src/index.ts` gives you.

### Render — `render.yaml`

Dashboard → New → Blueprint → pick this repo, paste the credentials when prompted. Long-lived
Node process, so the `index.ts` preflight, the SIGTERM drain and the in-memory rate limiter all
work as designed, and Singapore is the closest region to the Aiven service in Bangalore. Any
container host does the same (Railway, Fly, a VPS).

### Env vars, both targets

`GEMINI_API_KEY`, `DATABASE_URL`, `DATABASE_CA` (paste the PEM itself — `databaseCa()` takes a
path or the certificate text), `JWT_SECRET` (`openssl rand -hex 32`), `AI_ENABLED=true`,
`NODE_ENV=production`. `REVENUECAT_SECRET_KEY` is optional; while it is unset the server takes
the client's Pro claim on trust and says so at boot. Never set `PORT` on Vercel.

**There is no cron to port.** `node-cron` is in `package.json` and unused: the daily Discover
batch is generated lazily on the first `POST /v1/ai/feed` of the day and deduped by
`INSERT IGNORE` on `daily_feed`'s primary key. Nothing needs scheduling on either platform.

## Cutover

1. Deploy. Set `EXPO_PUBLIC_API_URL` in the EAS `preview` environment.
2. Ship the client with the repointed `gemini.ts`.
3. Remove `EXPO_PUBLIC_GEMINI_API_KEY` from EAS **and revoke it in Google Cloud.** A key that is
   no longer called is still valid in every APK already shipped.
4. Repoint `GeminiChatClient.kt` (native → needs a `version` bump and a rebuild).
