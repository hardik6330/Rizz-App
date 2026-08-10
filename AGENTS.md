# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# RizzCoach

Expo Router app. Screens in `src/app/(tabs)/`, AI in `src/services/`, persisted state in
`src/state/`, design tokens in `src/theme/tokens.ts`, responsive rules in
`src/theme/layout.ts`.

**`docs/README.md` is the companion to this file** — what the app is, an annotated tree of
every file, and the shipping/debugging reference. This file is the rules you must not break
while editing; when the two disagree, this one wins.

## Gemini engines — read this before touching any `*Engine.ts`

**The app no longer calls Gemini. `backend/` does.** `services/gemini.ts` was deleted: it
held `EXPO_PUBLIC_GEMINI_API_KEY`, which is inlined into the JS bundle and readable by anyone
who unzips the APK, with no server-side quota behind it — an open-ended bill, not a bounded
one. The key, every system prompt, every `responseSchema`, the model choice, the thinking fix,
credit enforcement and rate limiting all live on the server now.

**All AI traffic goes through `services/api.ts` (`callApi`). Never hand-roll a fetch.**
`isLiveApi` (from `state/session.ts`) replaces `isLiveKey`: it is true when
`EXPO_PUBLIC_API_URL` is set, and false means every engine serves mock seeds exactly as
before. Identity is `state/session.ts` — an anonymous install id the **server** mints on first
launch, traded for a 30-day JWT (revocable — see `token_epoch` below). It is not generated on the device: RN has no `crypto` global, so
that would mean either `expo-crypto` (native, therefore a rebuild rather than an OTA) or
`Math.random`, and this id is the credential that owns a user's credits.

**One documented exception:** `modules/profile-capture/.../GeminiChatClient.kt`. The chat
bubble generates a reply inside the accessibility service, where the RN/JS context may not
exist, so it cannot go through `services/api.ts` and makes its own HTTP call. It now posts to
`POST /v1/ai/chat` — **there is no Gemini key and no prompt in that file any more**, and it
authenticates with the install id rather than a token, because the bubble fires days after the
app was last opened and even a 30-day JWT may be dead by then. Do not add a second exception.

Four engines sit on top of `callApi`: `engine.ts` (chat screenshot), `bioEngine.ts` (bio
optimizer), `profileEngine.ts` (profile scan), `feedEngine.ts` (daily Discover lines). They
now contribute only a request body and mock seeds — prompts and schemas moved to
`backend/src/ai/`.

**`profileEngine.ts` has two modes and ONE result shape.** `'self'` coaches your own
profile; `'them'` reads someone else's and returns openers. `swipeStopper` /
`intentClarity` are generic score slots and `bioLines` holds bio lines or openers —
`PROFILE_LABELS[mode]` renames them per mode, so both modes share one schema, one engine
and one report renderer. Add a mode by extending `ScanMode`; the `Record<ScanMode, …>`
maps then fail to compile until prompt, stages, labels and mock seeds all exist.

**The `'them'` prompt's HARD RULES block is not decoration.** It analyzes a real person who
never consented: no appearance/body ratings, no protected-trait inference, no fake/catfish
verdicts, no location narrowing, no character judgements. Keep rails when editing that prompt.

**`thinkingConfig: { thinkingLevel: 'low' }` in `backend/src/ai/gateway.ts` is load-bearing —
do not remove.**
`gemini-flash-latest` is a thinking model and thinking tokens count against
`maxOutputTokens`. Without it the model spends the budget thinking, returns
`finishReason: MAX_TOKENS`, the JSON comes back truncated, `JSON.parse` throws — and the
engine **silently falls back to mock data**. Symptom: "the AI ignores my screenshot / shows
canned results." `backend/src/ai/gateway.selfcheck.ts` guards this with a deliberately small
token cap.

**`gemini-flash-latest` is a rolling alias, and the thinking key changed under it.** It
now resolves to `gemini-3.6-flash`. Gemini 3 dropped the numeric `thinkingBudget` for a
`thinkingLevel` enum and **400s on the old key** — "Request contains an invalid argument",
on every call, so the whole app quietly served mock data until someone noticed. Valid
levels are `low`, `minimal`, `high`; there is no `none`/`off`, and `high` reproduces the
MAX_TOKENS truncation. The alias can roll again: if every engine goes canned at once, run
the selfcheck before suspecting anything else.

**Gemini 3 cannot switch thinking off — but do not "buy headroom" for it.** `thinkingBudget:
0` used to mean zero; `thinkingLevel: 'low'` only means *less* (a six-line transcript still
measured `thoughtsTokenCount: 229`). Thinking counts against `maxOutputTokens`, so the
instinct is to raise the cap — don't. Gemini 3 sizes thinking as a *fraction* of the cap, so
it self-regulates: the same 40-line transcript measured thoughts=236/out=26 at 512 and
thoughts=404/out=26 at 2048. Raising the cap buys more thinking, latency and cost for an
identical answer. Measure with `usageMetadata` before changing any cap.

**`profile_scans` & `saved_items` (Vault) persistence (`backend/src/routes/user.ts`, `src/state/session.ts`, `src/state/useRizzStore.ts`, `src/app/vault.tsx`):**
- Profile scan summaries (`profile_scans`) and saved vault lines (`saved_items`) are stored in Railway MySQL and fetched via `GET /v1/user/scans` and `GET /v1/user/vault`.
- **Zero-PII Storage**: Raw screenshots and images are NEVER persisted; only structured JSON scan summaries and user-bookmarked text lines are kept.
- **Atomic Sync**: Server IDs are retained 1:1 on client store actions (`toggleSave`, `removeSaved`, `clearVault`) and synced with DB endpoints (`POST /v1/user/vault`, `DELETE /v1/user/vault/:id`, `DELETE /v1/user/vault`).
- **Account Deletion Integrity**: Account deletion transaction in `backend/src/routes/user.ts` purges both `profile_scans` and `saved_items` along with user records. Client `deleteAccount()` resets local `scanHistory` and `savedItems`.
- **Remove Scan Confirmation**: Removing a scan from history (`forgetScan` in `profile.tsx`) presents a themed confirmation dialog matching app design tokens (`scrim`, `dialog`, `dialogDanger`) before sending `DELETE /v1/user/scans/:id` and updating local state.

**The silent mock fallback hides live errors.** Every engine catches failures and returns
mock data so the app demos offline. When debugging "AI not working", check the console warn
(`[engine] live analysis failed`) first — a live key does NOT mean you're seeing live output.

**Key detection:** server-side only. `GEMINI_API_KEY` is validated at boot by `backend/src/env.ts`,
which **exits** rather than starting half-configured. Google issues both `AIza…` and `AQ.…`
formats; both go in the `x-goog-api-key` header, never the URL.

**A broken backend is indistinguishable from a broken app — check the server first.** The DB is
Railway MySQL; TLS to it needs a pinned CA and `checkServerIdentity` skipped. That CA is now
**bundled in `backend/src/db/railway-ca.ts`, not an env var** — a certificate carries a public
key, so it belongs in git while `DATABASE_URL` never can, and a required `DATABASE_CA` was the
service's most expensive misconfiguration: `db/client.ts` is evaluated at import, so a wrong
value crashed the function at module load and *every* route 500'd. `DATABASE_CA` survives only
as an optional override. Anything that does break at module load looks the same. Client-side that
looks like four unrelated bugs: engines serve mock seeds, and the Android bubble toasts
"RizzCoach isn't connected yet — open the app once" because `installId()` rejects, so
`_layout.tsx`'s `void installId().then(configureChat)` never configures `ChatEntitlement` and
`hasApi()` stays false. It self-heals on the next resume once the server answers — no rebuild.
`curl -X POST $API/v1/auth/device -H 'content-type: application/json' -d '{"platform":"android"}'`
before touching any client code; `/healthz` hits no database and stays green through all of it.
Details and the exact TLS failure modes: `backend/README.md`.

**Prompts are versioned by content hash**, not by a hand-bumped constant — `promptVersion()`
in `gateway.ts` logs the first 8 hex of sha256(prompt) on every call, so
`engine + prompt + totalTokens` attributes a quality or cost change to a specific edit. A
declared version is wrong the first time someone tweaks a prompt without bumping it.

**Cost lives in `totalTokens`, not `promptTokens + outputTokens`.** `gemini.ok` logs
`model`, `promptTokens`, `outputTokens`, `thoughtTokens`, `totalTokens` and `latencyMs` on
every call. Thinking tokens are billed but are NOT part of `candidatesTokenCount`, so
summing the two under-reports every call on a thinking model — take Gemini's own
`totalTokenCount`, which is what `totalTokens` carries. `thoughtTokens` is the one to watch
when a parse fails: truncation and "thinking ate the budget" look identical otherwise.

**Adding an engine:** it is now a two-sided change. Server: a system prompt in
`backend/src/ai/prompts.ts`, a `responseSchema` (uppercase OpenAPI types) in `schemas.ts`, and
a route in `routes/ai.ts` that wraps the call in `charged()` so a failure refunds. Client: a
request body and mock seeds, then `callApi<T>(path, body)`. Verify against the live API before
wiring UI.

**Credits and entitlement are server-side.** `chargeCredit()` is one atomic conditional
`UPDATE` that fails closed — a double-tap cannot spend the same credit twice (verified: 10
concurrent requests, exactly 3 granted). The store's `analysisCount` is now an optimistic
cache that every API response overwrites with the server's number, so reinstalling to clear
MMKV no longer grants three more analyses. Pro is verified against RevenueCat by
`POST /v1/user/pro`, which re-issues the token — call it after a purchase and after a restore
or a subscriber gets cut off at three analyses.

⚠️ **There is exactly ONE writer to `analysisCount` against a live API, and it is
`reportCredits`. Never add a second.** `incrementAnalysis()` in the store is guarded —
`isLiveApi ? state : count + 1` — and that guard is not defensive tidiness, it is a fix for
a bug that cost every free user a third of their trial:

```
callApi → server charges → envelope carries the POST-charge count
        → reportCredits sets analysisCount = 1
        → the screen then called incrementAnalysis() → 2
analysis 2 → server says 2 → set to 2 → +1 → 3 → locked out after TWO of three
```

It hid because the local increment is *correct* offline — with no API there is no envelope,
so it is the only counter there is. It only double-counts against a live server, which is
the configuration that ships and the one nobody runs while developing on mock data. The
guard lives in the store, not at the four call sites (Lab, Bio, Profile Scan, the chat-usage
drain in `_layout.tsx`), for the same reason `useOutOfCredits` is one selector: three copies
of a freemium rule is three chances to drift, and this one drifted silently for money.

**`LimitBadge` renders `used/limit`, not remaining.** `3/3 free` means three *spent*. If you
change that, change `ScreenHeader`'s `accessibilityLabel` with it — it currently says "3/3
free analyses used", which is the only place the direction is stated unambiguously.

**The bubble spends credits in a process the store cannot see, so `refreshCredits()` must run
BEFORE `configureChat()`.** The accessibility service charges `/v1/ai/chat` itself and mirrors
the server's balance into its own SharedPreferences snapshot. `_layout.tsx`'s resume hook then
pushes a snapshot *down* — so if it derives that snapshot from MMKV without pulling
`GET /v1/user/credits` first, it overwrites an accurate balance with a stale one and bubble
replies look free forever. `consumeChatUsage()` is always 0 now by design; it is kept only so
a future offline queue has somewhere to refill.

⚠️ **`refreshCredits()` has its own effect, and must NOT be folded back into the bubble
one.** It lived inside that effect, behind its `if (!isSupported) return` — and
`isSupported` is `Platform.OS === 'android' && native != null`. So the app's only credit
reconciliation was Android-only: on iOS, in Expo Go, and in any dev client without the
native module, `analysisCount` never came back from the server after launch, and a credit
spent on another device was never seen. The bubble's guard belongs to the bubble. The
ordering rule above still applies *inside* the bubble effect, which awaits its own
`refreshCredits()` before deriving the snapshot.

**The Lab quotes the chat before it answers it.** `labSchema` puts a `read` object first in the
schema and first in every mode's `required` list — last message verbatim, who sent it, the
running thread. Gemini emits properties in schema order, so the model commits to what the
conversation says before writing a reply; that ordering IS the grounding, and reordering the
schema quietly removes it. The client renders it above the replies. Mock seeds carry no `read`,
so the card's absence is a free tell that you are looking at canned data.

## Accounts — `backend/src/routes/auth.ts` + `src/app/account.tsx`

**Identity is two layers, and the order is the whole point.** `/v1/auth/device` still
mints the anonymous install identity on first launch — no signup wall, because asking for
an account before the first analysis destroys activation. `/v1/auth/signup` then **claims
that row** (`UPDATE … WHERE id = ? AND email IS NULL`); it never INSERTs. Create a row
there and you have handed out three more free analyses for the price of a form, which is
the exact hole the account exists to close.

**The reason accounts exist:** `install_id` lives in MMKV, MMKV dies with the app, so an
uninstall used to mean a brand-new user row with a fresh `analysis_count = 0`. Logging in
after a reinstall returns the original row. AGENTS.md previously claimed the server-side
credit move had already fixed this — it had not, and that claim was wrong until now.

**The account gate is mandatory, and there is NO REDIRECT — the route simply does not
exist.** `(tabs)`, `vault`, `analyzer` and `paywall` are wrapped in
`<Stack.Protected guard={accountStepDone}>`, and a guarded screen is not hidden, it is
**not declared**. So while the gate is up, `/account` is the entire app and the Lab tab has
no frame to render in. `_layout.tsx` calls `SplashScreen.preventAutoHideAsync()` at *module
scope* (an effect runs after the first frame, which is the frame being hidden) and
`account.tsx` calls `hideAsync()` once it has mounted.

This went through two wrong versions, and both are worth knowing so neither comes back. A
400ms `setTimeout` + push showed the Lab tab for four hundred milliseconds and then slid
signup over the top; users asked why the app "redirected" them. Removing the delay did not
fix it — **a push happens after the tabs have mounted and painted**, so the Lab was on
screen for the whole transition however the transition was configured. Removing the route
removes the frame. There was never anything to wait for either: the store is MMKV-backed
and rehydrates synchronously, so `account` is correct on the first render.

**Do not reintroduce a delay, a push, or a redirect here**, and do not move `hideAsync()`
into `_layout.tsx` — hiding it there uncovers whatever the navigator had painted at that
moment. The 3s timer is a dead-man's switch only: if `account.tsx` never mounts, a flash
beats a splash that never lifts.

**The mirror image is the post-login flash.** `signedInAs != null` is guarded by
`&& !isOnboarding` in `account.tsx`, because a successful auth flips `account` in the store
several frames before `router.replace('/')` can finish — `(tabs)` has to be declared and
mounted first. Without the guard the Sign-out view springs in during that gap. The CTA
stays busy through it: `submit()` ends with a bare `setBusy(false)` **after** the
try/catch, not a `finally`, so the `router.replace` early-return keeps spinning while a
rejected login still un-busies.

While the gate is showing there is no ✕, no swipe-back (`gestureEnabled: false`), and
Android back **exits the app** rather than being swallowed. Gated on `isLiveApi` — with no
API there is no account to make, and a wall nobody can pass is a bricked app.

**There is no password reset and no email verification. Both absences are load-bearing
copy.** The signup screen's amber "Save your password" block and the sign-out
confirmation are the only warning a user gets before an unrecoverable account. Do not
soften either, and delete them *only* alongside a shipped `/auth/reset`.
The corollary: **an email costs nothing to invent, so signup is NOT an anti-abuse
control.** Reinstall farming is bounded by the IP-scoped grant cap and the global spend
ceiling, not by this. Never describe it otherwise in a roadmap or a store listing.

**`requireAuth` reads the row on every request, and that is why tokens last 30 days.**
It re-reads `is_pro` and `banned_at` rather than trusting the JWT claims, so a ban or a
cancelled subscription takes effect at the next request instead of at the next token
refresh. That check IS the revocation mechanism — remove it and a 30-day token becomes a
30-day window. If it ever shows up in a latency profile, cache it for seconds; do not
delete it.

**Login and `/otp` now DO say whether an account exists. That reversal was deliberate —
do not "fix" it back.** There were once one `invalidCredentials()` for both failures and a
dummy scrypt hash to close the timing channel too. Correct security advice; bad product.
`/v1/auth/otp` answered `{ok:true}` for a signup into a taken address **without sending
anything**, so the commonest signup mistake produced "check your email" and a code that
never existed, with nothing in the UI able to tell the user. No wording fixes that — only
naming the case does.

Four codes now, and `account.tsx` branches on the code, not the message:

| Code | Status | When |
|---|---|---|
| `EMAIL_TAKEN` | 409 | `/otp` signup, or a signup race on `uq_users_email` |
| `NO_ACCOUNT` | 404 | `/otp` login, or `/login` with an unknown address |
| `WRONG_PASSWORD` | 401 | password branch only |
| `ACCOUNT_LOCKED` | 429 | 10 failures — **including the attempt that trips it** |

`nudgeMode()` in `account.tsx` moves the user to the other tab on the first two, keeping
what they typed. That is the whole point of naming them; an error string they have to read
and act on themselves is barely better than the silence.

**What still bounds enumeration:** the IP bucket on `/v1/auth/*` (`/otp` is 4 tokens
refilling at 0.02/s — about one probe every 50s per address), the per-account lockout, and
the fact that neither a password nor a mailbox gets easier to guess for knowing the address
is real. `dummyHash()` is no longer called by `/login` — it only ever existed to hide what
`/otp` now says outright — but it stays exported and selfchecked.

Usernames were always nameable (they are public); that is unchanged.

**`lib/password.ts` is `node:crypto` scrypt and nothing else.** N=2^15 needs 32MB, which
is exactly Node's default `maxmem` — so `MAXMEM` is set explicitly and every call passes
it. Raise N without raising `MAXMEM` and every login 500s with
`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. Parameters are stored inside the hash, so N can be
raised later without invalidating existing rows. Guarded by `password.selfcheck.ts`,
which also pins the NFKC normalisation — the same accented character composes differently
on iOS and Android keyboards, and without it a password set on one platform fails on the
other, with no reset to recover from.

**`DELETE /v1/user/me` is not a feature.** App Store Review 5.1.1(v) requires in-app
account deletion, and Play requires a deletion path. It is one statement, and **that is now a known bug**: migration 0004 added
`credit_events` (90-day retention) and `idempotency`, so the row's UUID outlives the
account. The route's own comment still claims "the user row IS the user's data" — true at
0003, false since 0004. Fix is three statements in a transaction, or `ON DELETE CASCADE`.

⚠️ **The Delete account BUTTON was removed from `account.tsx` by request; the route and
`deleteAccount()` in `session.ts` are intact.** That is a known, deliberate 5.1.1(v)
exposure, not an oversight — expect a rejection on submission until the button is restored
or a web deletion page is linked from the listing. Do not "clean up" the unused
`deleteAccount()` export; it is the other half of putting this back.

**`email` and `username` are the ONLY PII in the schema, and that is now the rule** —
`db/schema.ts` used to say "never any PII" and that line was traded deliberately in
migration 0001. Never a third column. Never log either one: `log.info('auth.signup')`
carries no fields on purpose, same rule as `logger.ts`.

**The rate limits on `/v1/auth/*` are load-bearing, not hygiene**, and they are
`dbRateLimit` — a shared MySQL token bucket, **not** the in-process `rateLimit`. That
distinction is the whole reason they survive Vercel: an in-process Map hands every warm
lambda a fresh set of attempts, so the platform silently multiplies the limit by however
many instances it felt like starting. `/v1/ai/*` and `/v1/user/*` stay in-process on
purpose (they are per-user, and the real gate is the database-backed credit cap).

Four buckets, tightest first: `/otp` 4 @ 0.02/s · `/signup` 5 @ 0.01/s · `/login` 8 @
0.05/s · `/v1/auth/*` 20 @ 0.2/s. `/otp` is tightest because it is the only endpoint that
spends real money and can be aimed at a **third party** — every call is an email to an
address the caller chose.

**The IP bucket is only half of the mailbomb defence.** It stops one host mailing a
thousand people; it cannot stop a thousand hosts mailing one. `lib/otp.ts` owns the other
half, and both halves are needed:

- `RESEND_COOLDOWN_MS` (60s) — the minimum gap between codes to one address.
- `MAX_SENDS_PER_WINDOW` (10 per 24h, migration 0007) — the **total**. The cooldown alone
  never capped it: rotate IPs, pace to 60 seconds, and you deliver 1,440 emails a day to
  one victim's inbox, on our bill and from our sending domain.

Both refusals return `null` from `issueOtp` and the caller answers as though it sent. A
"too many codes" message would confirm the address is worth attacking.

⚠️ **`email_otps` rows outlive their codes, and that is load-bearing.** The sweep is on
`created_at < now - 24h`, **not** `expires_at`. It used to drop rows ten minutes after
issue, which threw away the `sends` counter and reset the daily cap every ten minutes — a
limit that bounded nothing. A surviving row is not a live code: `verifyOtp` has
`expires_at > now` inside its DELETE predicate, so what lingers is a SHA-256 and a small
integer. `idx_otp_created` exists for that sweep; do not drop it.

## Backend invariants added after the audit

⚠️ **`idempotency.body` holds AI-generated content, so its retention is 15 MINUTES, not
24 hours.** The middleware stores the whole response envelope for replay, and for `/v1/ai/*`
that envelope's `result` **is** the generated content — profile reports about a named third
party, rewritten bios, openers, chat replies. `db/schema.ts` opens with *"NEVER add: images,
transcripts, replies, reports, or saved items"*, a rule written at migration 0003 and
quietly broken by this table at 0004; the account screen also tells users "Screenshots and
conversations are never saved". The body cannot simply go — replaying it *is* the feature,
and a retry with no stored answer charges a second credit — so what was wrong was the
DURATION. A retry happens while the user is still watching a spinner. **Do not lengthen
`RETENTION_MS`**; if some future offline queue needs longer, store a hash and re-derive. The
age is also checked on the READ, not just by the sweep, so correctness never depends on a
timer firing.

**Every log line carries `rid`, via `AsyncLocalStorage` — never thread it as a parameter.**
`withRequestId` in `lib/logger.ts` wraps the whole request in `app.ts`'s first middleware,
above CORS and every limiter, so a rejected request is traceable too. It is a REQUEST id,
not a user id; the no-PII rule is unchanged. An inbound `x-request-id` is honoured and the
id is echoed back, which is what lets a user paste one from a failing client into a bug
report.

**The body cap is `bodyLimit` from `hono/body-limit`, not a `content-length` check.** The
old guard read only that header — which a chunked client simply does not send, so
`Number(undefined ?? 0)` came out 0 and the 24MB it exists to prevent was buffered anyway. A
check that only stops the honest caller is not a check. Zod's `.max(MAX_B64)` runs *after*
`c.req.json()` has already buffered everything, so it cannot be the backstop either.

**`/v1/ai/feed` claims the day's generation in the `idempotency` table.** `inFlight` is a
module-level variable, so it collapses concurrent requests within one instance and does
nothing across instances — at 00:00 UTC every warm Vercel lambda missed the cache together
and each bought its own 4096-token generation, all but one discarded by the `INSERT IGNORE`.
The claim reuses `idempotency` rather than adding a table: it is already a keyed INSERT
IGNORE claim with a sweep, its ids are `<uuid>:<key>` so a `feed:` prefix cannot collide, and
its 15-minute retention is the right lease. A `GET_LOCK` would be textbook and is
unavailable — the lock is connection-scoped and the pool is `connectionLimit: 1` on Vercel,
so holding one and querying inside it deadlocks. Losers poll for 20s then generate anyway,
which is never worse than the old behaviour.

**`/v1/ai/*` answers credits from `creditsAfter(c, delta)`, not a second SELECT.**
`requireAuth` already read the row, so `is_pro` and `analysis_count` are on the context and a
charge moves the count by exactly one — the old `creditsFor()` was re-reading a number this
request had just written, on a pool of 1, after the Gemini call the user is already waiting
on. `delta` is 1 for a charge that stuck and **0** for `/profile`'s `not_a_profile` refund.
The gate is untouched: `chargeCredit` still reads the live row atomically, so nothing here
can hand out a free analysis; the only exposure is a meter one behind under same-account
concurrency, corrected on the next request. `/v1/user/credits` still does a real SELECT and
stays authoritative.

**Do NOT make the idempotency store fire-and-forget.** It is tempting (the ledger already
is), but Vercel freezes the instance after the response, so the write would silently not
land and the replay protection would evaporate without a symptom.

## Analytics — `src/services/analytics.ts` + `RizzAnalytics.kt`

**`track()` takes an event from a fixed union, never a name and a payload.** This app
transmits screenshots of other people's private conversations; a free-form
`track('x', {...body})` would put a transcript in an analytics warehouse forever, in another
company's jurisdiction, with no delete story. Same rule and same reason as
`backend/src/lib/logger.ts`. There is no overload that accepts arbitrary data, so the mistake
has nowhere to live. Never add a param carrying message text, bios, names, openers, `uiText`,
the package name of the app being viewed, or the install id.

**`app_open`, `first_open`, `session_start`, `screen_view` and `app_exception` are collected
automatically and are RESERVED** — logging them by hand is silently dropped. That is why
there is no `appOpen()`. `pro_purchased` is deliberately not named `purchase`: that is a GA4
commerce event expecting `currency`/`value`/`items`, RevenueCat already reports revenue, and a
half-populated `purchase` corrupts GA4's revenue model.

**Firebase is opt-in, gated on `GOOGLE_SERVICES_JSON` in `app.config.ts`** — the same
mechanism as `APPLE_TEAM_ID`, for the same reason. The Google Services Gradle plugin hard-fails
a build with no `google-services.json`, deep inside a Gradle task after the EAS queue wait.
Unset means no plugins, the app builds exactly as before, and `analytics.ts` no-ops because the
native module is absent. Set it and everything switches on with no code change.

**Both loaders inline a literal `require`.** Metro resolves `require` at build time from a
string literal; a variable argument fails the whole bundle with "Invalid call at line N". That
is why there are two near-identical functions instead of one helper — same constraint
`widgetBridge.ts` works within.

**`bubble_shown` / `bubble_tapped` are logged from Kotlin, and that is why this app uses
Firebase at all.** The bubble's entire lifecycle runs inside the accessibility service, in a
process where there is no JS context to call — the service runs whether or not the RN app is
alive. They are also the two most valuable events in the product. A native SDK is the only way
they land in the same user's funnel instead of an orphaned second identity. `RizzAnalytics.kt`
resolves Firebase reflectively and swallows every failure: a crash there does not fail an
analytics call, it silently kills the user's ability to analyse anything until they re-enable
the service in Settings.

**`bubble_shown` fires after the signature guard in `showBubble`**, or scrolling a profile
re-fires content-changed on the same screen and inflates the impression count.

**Crashlytics only — Sentry is deliberately absent.** They are the same product. Firebase is
already mandatory for the Kotlin-side events, so Crashlytics is nearly free incrementally and
it captures native crashes in the accessibility service, which a JS-first SDK handles poorly.
Two crash SDKs means two dashboards, duplicate alerts and double the native weight for one
signal.

**Paywall events are logged once, inside `paywall.tsx`.** The source rides in as a route param
(`/paywall?source=…`), so a new entry point is attributed for free and `paywall_viewed` cannot
drift from `paywall_dismissed`. Do not instrument the `router.push` call sites.

## Freemium rules

- `FREE_ANALYSIS_LIMIT` (3) — **lifetime**, shared by Screenshot Scan, Bio Optimizer and
  Profile Scan. Gate: `!isPro && analysisCount >= FREE_ANALYSIS_LIMIT`.
- `FREE_SWIPE_LIMIT` (10) — **per day**, Discover only.

**Swipe allowance lives in `src/state/limits.ts` — import it, never re-derive.** The store
counts swipes and Discover decides `locked`; when they disagreed, a cumulative count
permanently locked free users out of a feed that refreshes daily. Both call sites must use
`swipesUsedToday()` / `nextSwipeState()`.

**Discover's `seen` set is keyed by item ID, and `changeFilter` must NEVER clear it.** It
was a `Set<number>` of list indices, reset on every filter change — so the same line viewed
under "All" and again under "Openers" was two different indices and got charged twice.
Browsing three filters could burn the whole ten-swipe allowance on about four distinct
lines, with nothing on screen explaining why. Ids survive filtering, reordering, and the
daily AI batch landing on top of the curated set; indices survive none of it. The `arrived`
ref preserves the free first card that the old `new Set([0])` was quietly providing —
arriving on a screen is not a swipe.

Rejected work should not burn a credit — e.g. Profile Scan checks `isProfile` and returns
before `incrementAnalysis()`.

**RevenueCat needs a key per platform — Apple is `appl_`, Google Play is `goog_`.**
`isLiveRevenueCatKey()` in `state/limits.ts` is the one rule (self-checked). A stub key
silently drops that platform into mock mode, where `purchasePlan()` grants Pro for free
after a fake 1.4s sheet. Failure is silent and in the user's favour — check the key first
when "the paywall does nothing".

## Subscriptions — RevenueCat

**Two plans, weekly and annual. Do not add a third, and never add lifetime** — every
analysis costs a Gemini call, so a one-off payment is a subscription with the revenue
truncated and the cost left running. Live builds render RevenueCat's `current` offering, so
a price change is a dashboard edit; `MOCK_PLANS` in `services/purchases.ts` only backs
preview builds and must be kept in step.

**The RevenueCat App User ID IS `users.id`.** `configure()` runs once at launch with no id;
`identify()` then calls `logIn(users.id)`, driven by one effect in `_layout.tsx` keyed on the
store's `account`. Never call `logIn` from a screen — a forgotten call site is a subscriber
who reinstalls and cannot restore, because the SDK's default `$RCAnonymousID:` is cached on
the device and dies with the install. That is also what used to collide with `uq_users_rc`
and 500 the restore.

**Entitlement is `proNow()`, never `is_pro = 1`.** `lib/entitlement.ts` is the one fragment;
every read site (`chargeCredit`, `creditsFor`, `requireAuth`, both `sessionFor` queries)
uses it. `is_pro` alone ignores `entitlement_expires_at`, which is how a cancelled
subscriber keeps unlimited AI at our cost, for ever, invisible in every dashboard.

**One writer: `syncEntitlementFor()`.** Both `/v1/user/pro` (client, after a purchase or
restore) and `/v1/webhooks/revenuecat` (RevenueCat, after a renewal or cancellation) go
through it, so the race between them is harmless — whoever lands second re-asks RevenueCat
and writes the same answer. **Webhook payloads are a trigger, never a source of truth:**
delivery is at-least-once and ordering is not guaranteed, so `rc_events.event_id` is the
idempotency key and the entitlement always comes from `GET /subscribers`.

The webhook is authenticated by signature ONLY — RevenueCat has no JWT — so it must stay
outside every `requireAuth` prefix in `app.ts`. `lib/rcSignature.ts` owns that; it has a
selfcheck. Always reply 200 once the signature passes: anything else buys five retries
(5/10/20/40/80 min) and then RevenueCat gives up.

`REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_SECRET` are **required in production** —
`env.ts` exits without them.

**The client half is still stubbed and that is the current state of play.**
`EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is `goog_mock_key`, so `isLiveRevenueCatKey()` is
false and `initPurchases()` returns early: no Play sheet, `purchasePlan()` fakes a success
after 1.4s. The server now refuses that claim (it holds a real `sk_` key), so a mock
"purchase" logs `rc.sync isPro:false verified:true` and `is_pro` stays 0 — the two halves
disagreeing correctly, not a bug. `EXPO_PUBLIC_*` is inlined at build time, so the fix is
a **rebuild**, never `eas update`. Setup steps live in
[docs/revenuecat-keys.md](docs/revenuecat-keys.md); the whole architecture, the
troubleshooting table and the launch checklist in
[docs/revenuecat.md](docs/revenuecat.md).

## Terms and Privacy — `backend/src/routes/legal.ts`

**Two dead links on the purchase screen is a rejection, not a nit.** App Store Review
3.1.2 requires a working EULA and privacy link on any auto-renewing subscription, and Play
requires a privacy policy URL on the listing. Both pointed at `rizzcoach.app`, which 404s,
and nobody noticed for months because nobody taps their own legal links.

They are served **by the API**, not a separate site: `vercel.json` rewrites every path to
the Hono app, so `/terms` and `/privacy` are two routes and no new infrastructure. They are
registered at the very top of `app.ts`, above every `use()`, so no auth or rate-limit
middleware can end up in front of a page a store reviewer has to reach while logged out.

**The URLs live in `src/constants.ts` and nowhere else** — `paywall.tsx` imports them.
Unlike the RevenueCat key these are plain JS, so changing them **is** OTA-able. To move to
`rizzcoach.app`, attach the domain to the same Vercel project and change those two lines;
the routes do not move. Its DNS already points at Vercel — it just isn't claimed by a
project, which is what produces `DEPLOYMENT_NOT_FOUND` rather than an honest 404.

⚠️ **The content is a DRAFT with unfilled placeholders** — `[LEGAL ENTITY NAME]`,
`[REGISTERED ADDRESS]`, `[JURISDICTION]`, `[CITY, COUNTRY]` — and `support@rizzcoach.app`
does not yet receive mail, while both documents promise it as the route for deletion and
data requests. Neither can ship as-is.

**The privacy policy's strongest claims are enforced by `db/schema.ts`, not by prose.** It
states plainly that screenshots, message text, bios and generated openers are never stored,
which is true because there is nowhere to put them. Add such a column and the policy
becomes a false statement to users and to two app stores — this is the sharpest reason the
"NEVER add: images, transcripts, replies, reports, saved items" rule is not negotiable.
The Android Accessibility Service is disclosed separately and specifically, which Play
scrutinises hard; keep that section in step with what the service actually reads.

## Discover feed

`dailyFeed` (AI, generated once/day) leads; `data/feed.ts` curated items back it up.
Cached in the store under a `YYYY-MM-DD:vN` tag. **Bump `vN` in `discover.tsx` whenever the
feed item shape or batch size changes**, otherwise today's stale cache is served and your
change appears to do nothing.

AI items reuse the bundled backgrounds from `data/assets.ts` and use `testedBy.age === 0` as
the sentinel for the "✨ Fresh today" tag (no fake tester invented).

## Responsive layout — `src/theme/layout.ts`

`tokens.ts` owns the design language (colour, type, spacing). **`layout.ts` owns everything
that depends on the *device*: screen width, height, safe-area insets and the OS font scale.**
Two numbers used to be copy-pasted into every screen — a 24pt gutter and `paddingBottom: 148`
— and neither adapted to anything. Both are now derived; do not reintroduce either.

- **`useLayout()` → `{ width, height, fontScale, gutter, landscape, compact, tablet }`.**
  `gutter` is the *only* horizontal padding a screen body should use. It tightens below 360pt
  and, past `CONTENT_MAX` (560), grows so the column stays readable and lands centred — which
  is why there is no max-width wrapper anywhere. It drops straight into the existing
  `paddingHorizontal`, so screens keep their shape.
- **`useTabBarClearance()` is the bottom padding of every screen behind the floating tab
  bar.** It mirrors `FloatingTabBar`'s own geometry *including font-scale growth*; the old
  flat 148 let the last card slide under the bar at large accessibility text sizes. If you
  change the bar's padding or label size, change `TAB_BAR_HEIGHT` with it.
- **`cardHeightFor(windowHeight, designed, min)`** for hero cards. `GlowDropZone` and
  `AnalyzingOverlay` had fixed heights that clipped their own copy at large font scales and
  ate a whole landscape screen. `AnalyzingOverlay`'s scan beam interpolates over this value —
  hardcode the height again and the beam overshoots the card.
- **`RAIL_WIDTH`** is what `FeedCard` reserves for `ActionRail`. Its `paddingRight` is
  `gutter + RAIL_WIDTH + spacing.lg`; the rail's own `right` is `max(spacing.md, gutter -
  spacing.md)`, which is the original 12 on a phone and tracks the centred column on a tablet.

**`flex: 1` on a pill needs `minWidth: 0`, and its label needs `flexShrink: 1`.** RN defaults
`flexShrink` to 0 (unlike the web), so a label that doesn't fit forces its pill past its share
of the row and spills outside the gutter — and `numberOfLines` cannot ellipsize text that was
never given a bounded width. This bit `ModeSelector` ("Vibe Check"), the Bio vibe row
("Ambitious") and the Profile report tabs. Any new segmented row needs all three:
`minWidth: 0`, `flexShrink: 1`, `numberOfLines={1}`.

**Font scale: cap chrome, never cap content.** Body copy, results and AI output scale freely —
that is an accessibility setting, not a suggestion. Text living inside a fixed-size container
(tab bar labels, credit meters, count bubbles, chips) gets `maxFontSizeMultiplier` 1.0–1.3, or
it bursts its container at 200% system text.

**Reduce Motion is already handled by Reanimated — do not hand-roll it.** Every animation
defaults to `ReduceMotion.System`, so `withTiming` jumps to its final value and `withRepeat`
stops after one pass. What that leaves behind is a *resting state*, and that is the only thing
worth checking: a pulsing dot settles lit (fine), but `AnalyzingOverlay`'s scan beam froze
parked at the bottom edge of the card for the whole analysis, reading as a rendering bug. So
that one beam is gated on `useReducedMotion()` and removed outright. Any new looping animation:
check where it *stops*, don't add another hook.

**Palette contrast is arithmetic, not taste — `contrast.selfcheck.ts` owns it.** `textTertiary`
shipped at 3.19:1 on `surfaceHigh` while carrying 12px body copy and TextInput placeholders,
which is a Play Store accessibility finding that neither `tsc` nor a screenshot can see. It is
now `#868697` (4.75:1). The check also asserts `textSecondary`/`textTertiary` stay ≥1.2× apart,
because the tempting fix is to make every grey the same grey and lose the type hierarchy.
`violetDeep` (2.33:1) is deliberately unchecked — it is only ever a gradient stop, and WCAG does
not apply to decoration; make it text and the check will fail, which is intended. `surfaceHigh`
is the worst of the three surfaces, so check new greys there.

**Both modals are full-screen on Android.** `vault` and `paywall` must apply `insets.top`
themselves — iOS sheets report 0 there, so it is free on iOS and load-bearing on Android.
Without it the Vault title and the paywall close button sit under the status bar.

Rotation and tablets are enabled (`orientation: "default"`, `ios.supportsTablet: true`), so
**every new screen must survive a ~390pt-tall viewport.** A centred `flex: 1` column silently
clips there — `LockOverlay` had to become a `ScrollView` for exactly this reason.

## Conventions

- Read tokens from `src/theme/tokens.ts`. Never hardcode hex or px in screens. Screen gutters
  and tab-bar clearance come from `layout.ts`, never from `spacing.xl` / a literal.
- All touchables route through `HapticPressable` so touch feel stays consistent.
- **`ErrorBoundary` is exported from BOTH `app/_layout.tsx` and `app/(tabs)/_layout.tsx`, and
  Expo Router finds it BY NAME.** Rename the export and it silently stops existing — there is
  no warning, and the symptom is the one it exists to prevent: a render throw unmounts the
  whole tree to a white screen with no way back but a force-quit. Two boundaries because
  Router uses the nearest: a broken report on Profile Scan keeps the tab bar and the other
  three tools alive, while the root one covers the auth gate, which has nothing behind it.
  `AppErrorBoundary` deliberately uses no animation, no store read, no `useToast` and no
  `expo-image` — a boundary that throws is a crash with extra steps — and shows the stack only
  under `__DEV__`, because in release that is an internal trace shown to a stranger and this
  app's error strings can quote model output.
- The three AI tools share `<ScreenHeader icon title tint />` (wordmark + credit meter +
  vault) and `<StagedLoader stages stage badge tint />` (text-only "thinking" card). The Lab
  uses `AnalyzingOverlay` instead — it sweeps a beam over the picked image, a genuinely
  different visual.
- Free-credit gate: `useOutOfCredits()` from the store. Don't re-derive it.
- **Any screen that shows a result by flipping `phase` to `'done'` needs
  `useBackToIdle(phase === 'done', reset)`.** All three AI tools render the report *in
  place* rather than pushing a route, and each tab is the root of its own stack — so
  Android hardware back skipped past the report and exited the app, with users reading the
  refresh icon as "scan another" rather than "close". Pass `false` during `'working'`: the
  request is in flight and the credit is already charged. `reset` must be a `useCallback`
  or the listener resubscribes every render.
- `toast.show(msg, ms?)` — pass a longer duration for long messages (default 1.7s).
- Persisted state must be added to `partialize` in `useRizzStore.ts` or it won't survive
  reload.
- **Two screens have text inputs — `bio.tsx` and `account.tsx` — and each needs BOTH halves
  of the keyboard fix.** `automaticallyAdjustKeyboardInsets` is **iOS-only**; under the
  edge-to-edge display Expo SDK 54+ and RN 0.86 enforce, the Android window no longer resizes
  when the keyboard opens, so `adjustResize` stopped doing anything and Android had no
  handling at all. `useKeyboardInset()` (`src/utils/`) is the Android half: add its height to
  `paddingBottom` so the ScrollView has somewhere to scroll to. Drop `insets.bottom` while the
  keyboard is up — the gesture bar is behind it, and paying for both leaves a gap.

## Shipping (EAS)

```bash
eas build -p android --profile preview                       # APK; needed before ANY update lands
eas build -p ios --profile simulator                         # iOS, no Apple account needed
eas update --branch preview --environment preview -m "…"     # JS-only OTA
```

**iOS builds without an Apple account: use `--profile simulator`.** It extends
`preview`, so it carries the same channel and the same `preview` environment (and
therefore the same Gemini key). Use it to check iOS before paying for anything.

**`app.config.ts` layers over `app.json`; the iOS widget is opt-in.** Everything
static stays in `app.json`. The widget plugin needs an Apple Team ID — a credential —
so it attaches only when `APPLE_TEAM_ID` is set, and iOS builds fine without it
(`widgetBridge.ts` already no-ops when the native module is missing). The old
`REPLACE_WITH_APPLE_TEAM_ID` placeholder did not fail loudly; it failed at signing,
after the queue wait, which meant nobody could build iOS at all. Never hand-declare
the App Group entitlement or an `appExtensions` target next to the plugin — it
generates both, and doing it twice duplicates the entitlement AND the extension
target. Verify any config change with `npx expo config --type public`.

**`--environment` is required on `eas update`** (in `--non-interactive` it errors without it).
It selects which EAS environment's variables get baked into the bundle — the same `preview`
environment that holds the Gemini key. Omit it and you are not shipping the key.

**An update only reaches builds whose runtimeVersion matches it.** Publishing succeeds
regardless — to zero devices if nothing matching is installed. Build first, then update.

**A channel with no branch mapped to it serves nothing, and says nothing.** Builds resolve
updates through their *channel*; `eas update --branch X` publishes to a *branch*. If the two
are not linked, every publish reports success and reaches zero devices — the same symptom as a
runtimeVersion mismatch, from a different cause. `eas channel:view preview` printing "No
branches are pointed to this channel" is the tell; `eas channel:edit preview --branch preview`
is the fix, once, forever. And an update that *does* arrive applies on the **second** launch:
Expo boots the cached bundle and downloads in the background.

**Build keys come from the EAS environment, not `.env`.** `.env` is gitignored so it never
reaches EAS. A build profile only loads them if it declares `"environment"` — `preview` and
`production` do. Drop that field and the build still succeeds, with no Gemini key baked in:
`EXPO_PUBLIC_API_URL` is missing, `isLiveApi` is false and every engine silently serves mock
data. `eas env:list
--environment preview` before blaming the model.

⚠️ **`EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is a stub (`goog_mock_key`), so preview builds
hand out Pro free.** Set it before production — and note that this one is **not
OTA-able**: `EXPO_PUBLIC_*` is inlined into the bundle at build time, so an installed
build compiled with the stub stays in mock mode however many updates you push at it. It
needs `eas build`. Same trap as any other `EXPO_PUBLIC_*` change, and the most expensive
one to discover late.

**`runtimeVersion` is `appVersion` — and that is now YOUR responsibility to police.**
It was `fingerprint`, which is safer and was unusable in practice: every native or dependency
change minted a fresh runtime version and orphaned every installed build, so each OTA landed
on zero devices until a new APK was built and reinstalled. Three builds in one morning had
three fingerprints and an update matched none of them.

Under `appVersion` every build sharing `version` (`app.json`, currently `1.0.5`) accepts the
same updates, so JS-only fixes actually reach installed apps. The cost is that the safety net
is gone:

> **Bump `version` in `app.json` in the SAME change as any native edit.** Native means
> anything under `modules/`, a new/updated dependency with native code, a plugin, or an
> `app.json` field that lands in the manifest. OTA-ing JS that calls a native symbol the
> installed build does not have crashes it on launch — for everyone, with no way to recover
> except a reinstall. `fingerprint` used to catch this for you. Nothing does now.

Rule of thumb: **JS/TS/assets only → publish an update. Anything else → bump `version`, build,
reinstall.** `npx expo-updates fingerprint:generate --platform android` still tells you
whether native actually changed, even though the number no longer gates delivery — diff it
against the last build's fingerprint when unsure.

**Any local Android build (`expo run:android`, `./gradlew`, opening the project in Android
Studio) mutates `node_modules`.** Gradle and its Buildship plugin write `build/`, `.gradle/`,
`.classpath`, `.project` and `.settings/` into autolinked packages — none of which are in the
npm tarballs. This no longer breaks OTA delivery, but `npm ci` before `eas build` is still the
fix if a build behaves oddly.

**Adding Firebase, or any native dependency, means a `version` bump — not an OTA.** Analytics
landed as 1.0.1 → 1.0.2 for exactly this reason.

**Native is CNG.** `/android` and `/ios` are ignored by git AND EAS and regenerated from
`app.json` each build. Editing `android/` locally does nothing — use `app.json` or a plugin.

## Checks

```bash
npm run checks                                          # tsc + eslint + limits, the gate
npx tsc --noEmit                                        # must pass
npx eslint src modules                                  # must be 0 errors
node src/state/limits.selfcheck.ts                      # swipe-allowance + store-key rules
node src/theme/contrast.selfcheck.ts                    # palette vs WCAG AA (reads tokens.ts as text)
cd backend && node --import tsx src/lib/password.selfcheck.ts                  # scrypt round-trip, no env needed
cd backend && node --import tsx src/lib/rcSignature.selfcheck.ts               # webhook HMAC + replay window, no env needed
cd backend && node --env-file=.env --import tsx src/ai/gateway.selfcheck.ts   # live API (1 tiny call)
cd backend && node --env-file=.env --import tsx src/vercel.selfcheck.ts       # serverless POST body
cd backend && npx tsc --noEmit                          # server must pass too
```

`*.selfcheck.ts` are framework-free Node scripts (Node 24 strips types natively) and are
excluded from `tsconfig.json`. Add one next to non-trivial pure logic; don't add a test
framework.

**ESLint exists now (`eslint.config.js`) and must stay at 0 errors.** It is
`eslint-config-expo/flat` taken wholesale — do not hand-assemble a rule list — with four
deliberate deviations, each documented inline:

| Rule | | Why |
|---|---|---|
| `react-hooks/exhaustive-deps` | **error** (Expo ships warn) | This is the rule that catches *this* app's bug class — stale `useCallback` captures and listeners resubscribing every render. A warning in a codebase with no lint history is a warning nobody clears |
| `react-hooks/immutability` | **off** | It flags `sharedValue.value = withSpring(…)`. The rule does not know Reanimated; a shared value's assignment IS the API and React never re-renders for it. Reinstate when `react-hooks` learns worklets |
| `@typescript-eslint/no-require-imports` | **off** | All five `require()`s are optional native modules (`react-native-purchases`, `react-native-mmkv`, two Firebase SDKs) that must not be hoisted, and Metro resolves only from a string literal — so they can be neither `import` nor `import()` |
| `react-hooks/set-state-in-effect` | **warn** | The 3 hits are "sync React to something React cannot see" (accessibility permissions granted in Settings; the auth gate re-arming after sign-out). Left visible so a genuinely cascading one still surfaces |

An `eslint-disable-next-line` needs a reason beside it. The two in the tree
(`discover.tsx`'s `exhaustive-deps` on the daily-feed fetch, and `react-hooks/refs` on
`onViewableItemsChanged` — FlatList re-measures if that prop changes identity) both have one.

**Run `vercel.selfcheck.ts` after touching `backend/src/vercel.ts`, and never trust a local
run to cover it.** `npm run dev` uses `src/index.ts` and a real Node server, so the serverless
entrypoint is the one file in the repo that no local check exercises. Both published Hono
Vercel adapters are broken on a plain function in `api/`, in opposite directions, and both fail
as a bare 60s `FUNCTION_INVOCATION_TIMEOUT` with nothing logged: `@hono/node-server/vercel`
rebuilds the body from a stream Vercel already drained, so `c.req.json()` never settles and
every POST hangs (GETs are fine — which is why `/healthz` looked healthy for hours);
`hono/vercel` expects to be handed a web `Request` and gets Node's `(req, res)`, so nothing is
written to `res` and even `GET /` hangs. Hence the hand-rolled `(req, res)` handler. Read the
body from `req.body` when the launcher parsed it and **only** read the stream when it has not
ended — awaiting `end` on a spent stream is the hang. On the client this is indistinguishable
from an outage: `callApi` throws and all four engines serve mock seeds, i.e. "the AI ignores my
screenshot."

**`layout.ts` deliberately has no selfcheck.** It transitively imports `react-native` (via
`tokens.ts`), which Node cannot parse — and the alternative, duplicating the spacing values
into an import-free module, is worse than the arithmetic being unguarded. Verify layout
changes with `npx expo export --platform android`, which catches everything a type error
wouldn't.
