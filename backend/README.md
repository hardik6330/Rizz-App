# RizzCoach API

The server that holds the Gemini key. Operational notes live here; the architecture is in
[docs/README.md §5](../docs/README.md).

## Why this exists

`EXPO_PUBLIC_GEMINI_API_KEY` used to be embedded in the JS bundle **and** pushed into Android
SharedPreferences by `configureChat`. Anyone who unzipped the APK had it, with no server-side
quota behind it — an open-ended bill, not a bounded one. The key, every prompt, every response
schema, credit enforcement and rate limiting now live here, and nothing on the device can
reach Google.

## Run

```bash
cp .env.example .env      # fill GEMINI_API_KEY, JWT_SECRET, DATABASE_URL
npm install
npm run db:migrate        # or: mysql < src/db/migrations/0000_init.sql
npm run dev
```

### TLS to a managed database

Managed MySQL signs with a **CA that Node does not trust**, so a correct config still fails on
the handshake. Point `DATABASE_CA` at the PEM (`*.pem` is gitignored) and verification passes.
Two flavours, and they fail differently:

- **Aiven / PlanetScale / DO** issue a per-project CA with a real hostname on the leaf.
  `HANDSHAKE_SSL_ERROR` until you download it (Aiven: service → *CA certificate* → download).
- **Railway** proxies MySQL's own auto-generated cert, so there is nothing to download —
  `self-signed certificate in certificate chain`. Dump the issuing CA off the live handshake:
  `openssl s_client -starttls mysql -connect <host>:<port> -showcerts`.

Railway then fails a *second* time, and this one is not a misconfiguration: that cert's CN is
`MySQL_Server_<v>_Auto_Generated_Server_Certificate`, which can never match `*.proxy.rlwy.net`,
so the hostname check rejects a certificate that is otherwise exactly the one we pinned. Hence
`checkServerIdentity` in `client.ts` — skipped **only** when a CA is pinned, because pinning is
the stronger guarantee anyway (that CA's key is unique to the instance, so only that server can
present a verifying chain). With no CA pinned, Node does the full public-CA + hostname check.

The tempting fix for any of the above is `rejectUnauthorized: false`. Don't — every row on this
connection is a credit balance or a purchase state, crossing the public internet to a managed
host, and an unverified peer is a silent MITM. It stays true in every branch of `client.ts`.

`npm run db:migrate` is currently broken — drizzle-kit's bundled esbuild rejects this repo's
`target: ES2023`, and there is no `meta/_journal.json` because `0000_init.sql` is hand-written.
Apply it directly (`mysql < src/db/migrations/0000_init.sql`).

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

### Vercel — `vercel.json` + `api/index.mjs`

Import the repo, add the env vars below, deploy. `installCommand` only installs `backend/`, so
the root Expo dependencies are never touched.

> **Root Directory must be `./`, NOT `backend`.** It is the one setting that lives in the
> dashboard rather than in this repo, and getting it wrong fails in a way that reads like a
> broken build command: `vercel.json` is still read from the repo root, but the commands run
> inside the Root Directory, so `cd backend && …` reports `No such file or directory`. The tell
> is `Detected "engines": { "node": ">=22" }` in the build log — that field only exists in
> `backend/package.json`, so seeing it means Vercel is sitting one directory too deep.
>
> It cannot be worked around from here: Vercel discovers functions in `<root>/api/`, and esbuild
> has to reach `src/state/limits.ts` at the repo root because `lib/limits.ts` re-exports it.

Five things are load-bearing:

| | Why |
|---|---|
| The function is a **bundle**, not source | Every import here ends in `.ts`. Vercel's Node builder transpiles file-by-file and does **not** rewrite specifiers, so loading `src/` directly dies with `ERR_MODULE_NOT_FOUND … 'backend/src/ai/prompts.ts'` on the first request. `npm run build:vercel` bundles to `dist/vercel.mjs`; `api/index.mjs` is a committed one-line re-export, because Vercel scans `api/` in the **source** tree and never finds a generated entrypoint |
| `@hono/node-server/vercel` + a single `export default` | mysql2 needs a real TCP socket, so this must be the Node runtime — `hono/vercel` is the Web/Edge handler. And named `GET`/`POST` exports are Next.js App Router only; a plain Vercel function exporting just those has no handler at all |
| `maxDuration: 60` | Must stay **above** the 45s `AbortSignal.timeout` in `ai/gateway.ts`. Serverless has no SIGTERM, so that abort is the only thing that still lets `charged()` refund. Vercel's default is 10s and Hobby caps at 60s — a 3–15s Gemini call needs the headroom |
| `connectionLimit: 1` when `process.env.VERCEL` | Every warm instance gets its own pool; Aiven's small plans cap `max_connections` in the low tens |
| The catch-all rewrite | Vercel preserves the original URL through a rewrite into a function, so Hono still sees `/v1/…` and needs no `basePath()` |
| `framework: null` + `public/robots.txt` | Without the first, Vercel's Node-server detector hunts for `index.js`/`server.js`, never looks in `api/`, and fails with `No entrypoint found`. With it, Vercel demands an `outputDirectory` that exists **and is non-empty** — hence one committed file. It is a `robots.txt` and not an `index.html` on purpose: Vercel resolves the filesystem before applying the rewrite, so `public/index.html` would shadow the API's own `GET /`. Do **not** point `outputDirectory` at `.` to satisfy this — it would publish the whole repo, source included, as static files |

Accepted costs: `rateLimit` becomes per-instance and effectively off (the per-day cap in
`middleware/credits.ts` is in the database and still holds the Gemini bill); and an unreachable
database surfaces as live 500s instead of the failed deploy that `src/index.ts` gives you.

### Render — `render.yaml`

Dashboard → New → Blueprint → pick this repo, paste the credentials when prompted. Long-lived
Node process, so the `index.ts` preflight, the SIGTERM drain and the in-memory rate limiter all
work as designed. Pick the region closest to the database — currently Railway, so match its
region rather than assuming Singapore. Any container host does the same (Railway, Fly, a VPS).

### Env vars, both targets

`GEMINI_API_KEY`, `DATABASE_URL`, `DATABASE_CA`, `JWT_SECRET` (`openssl rand -hex 32`), `AI_ENABLED=true`,
`NODE_ENV=production`. `REVENUECAT_SECRET_KEY` is optional; while it is unset the server takes
the client's Pro claim on trust and says so at boot. Never set `PORT` on Vercel.

**`DATABASE_CA` must be the certificate TEXT here, never a path.** `databaseCa()` accepts
either — a value starting with `-----BEGIN` is used verbatim, anything else is `readFileSync`'d
— and locally it is a path, so copying `./railway-ca.pem` into the dashboard looks right and
is not. The PEM is gitignored, so no such file exists on the host: `readFileSync` throws
`ENOENT` at module load, which takes down **every** route, not just the DB ones. Symptom is a
500 on `GET /` and `/favicon.ico` too, and a client that silently serves mock seeds.

**There is no cron to port.** `node-cron` is in `package.json` and unused: the daily Discover
batch is generated lazily on the first `POST /v1/ai/feed` of the day and deduped by
`INSERT IGNORE` on `daily_feed`'s primary key. Nothing needs scheduling on either platform.

## Cutover — done

All four steps are complete: the API is deployed and `EXPO_PUBLIC_API_URL` is set in the EAS
`preview` environment, `services/gemini.ts` is deleted, `EXPO_PUBLIC_GEMINI_API_KEY` is gone
from EAS, and `GeminiChatClient.kt` posts to `/v1/ai/chat` instead of Google.

The one thing to verify by hand: **the old key is revoked in Google Cloud.** A key that nothing
calls any more is still valid inside every APK already shipped.
