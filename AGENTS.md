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
`isLiveApi` (from `services/auth.ts`) replaces `isLiveKey`: it is true when
`EXPO_PUBLIC_API_URL` is set, and false means every engine serves mock seeds exactly as
before. Identity is `services/auth.ts` — an anonymous install id the **server** mints on first
launch, traded for a 30-day JWT (revocable — see `token_epoch` below). It is not generated on the device: RN has no `crypto` global, so
that would mean either `expo-crypto` (native, therefore a rebuild rather than an OTA) or
`Math.random`, and this id is the credential that owns a user's credits.

⚠️ **The bubble's reply goes to the CLIPBOARD, and that is a compliance boundary — never
auto-send, auto-paste, tap send, or add a "reply for me" mode.** Play prohibits any use of
the Accessibility API that lets an app "autonomously initiate, plan, and execute actions".
The service already performs the one UI action it is allowed: `scrollAndRead()` scrolls the
thread up to gather history and `restoreScroll()` puts it back — user-triggered and
deterministic, which is the permitted shape. Making it *send* crosses into the automation
the policy bans and puts the Android app at risk. **That scroll must also stay disclosed**
in `analyzer.tsx` and in `/privacy` §4; both said "the visible chat text" until it was
noticed that the service reads more than was on screen. Full argument and the review pack:
[docs/play-accessibility-declaration.md](docs/play-accessibility-declaration.md).

⚠️ **Name Google Gemini on every surface that uploads, and never write "our AI".** Five places
describe the same pipe — `app/ai-consent.tsx`, `components/feature/AiNotice.tsx` (rendered by Lab,
Profile Scan and Bio Lab), `analyzer.tsx`, `/privacy` §4, and the Play declaration. Change one
and change all five; a reviewer who finds them disagreeing has a reason to distrust every one
of them. `AiNotice` replaced three per-screen copies of "Analyses are private. Never posted,
never shared." — which was not thin but *backwards*: a person reading it about a screenshot of
someone else's conversation concludes the analysis runs on their phone. It runs at Google.

⚠️ **`useAiConsent()` gates every AI tool, and it is NOT a paywall.** It reads one flag —
`aiConsent` — and touches no credit, plan or entitlement. **A Pro subscriber is asked exactly
like a free user**, because the question is whether a private conversation may leave the device
and money does not buy a different answer. Never skip it for payers, never fold it into
`useCreditGate` (a change to the free tier would then be a change to a compliance surface), and
keep it FIRST at each call site — before the credit gate and before the image picker, so
consent is recorded while the app still holds none of the user's data.

The gate has one deliberate exemption: **the Android bubble**. `analyzer.tsx` is a stricter
disclosure than the consent screen — it names Gemini, needs two OS permissions plus an in-app
switch, and cannot be reached by accident — so a capture arriving from it is already consented.
Do not stack a second prompt on that path.

**Dismissing `/ai-consent` is a valid answer and must stay easy.** `gestureEnabled` is ON for
that route, unlike the account and onboarding gates: closing it means "no, do not upload my
screenshots", the flag stays false, and the rest of the app keeps working. A consent screen
that is harder to refuse than to accept is the dark pattern the rule exists to stop — so no
pre-ticked box, no "Decline" that does something other than close, and no disabling the app
until they agree.

**Re-read Apple's third-party-AI guideline before the first TestFlight submission** rather than
trusting this paragraph — it is a fast-moving area and this was written against the November
2025 wording.

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

⚠️ **The model is now PINNED — `MODEL = 'gemini-3.6-flash'`, not `gemini-flash-latest`.**
That alias moved twice underneath this codebase, and the block above was written about the
first time: Gemini 3 dropped the numeric `thinkingBudget` for a `thinkingLevel` enum and
**400s on the old key** — on every call, so the whole app quietly served mock data until
someone noticed. Valid levels are `low`, `minimal`, `high`; there is no `none`/`off`, and
`high` reproduces the MAX_TOKENS truncation.

The second roll broke nothing and cost more: the alias landed on `gemini-3.6-flash` at
**$1.50/$7.50** per 1M tokens against the **$0.25/$1.50** of the tier below, so the primary
cost line of the business rose ~6x with no commit and no log line. `gateway.ts` had a
comment claiming it was pinned for months while the constant was still the alias — do not
let those two drift again.

⚠️ **Standing policy: pick the BEST model, never the cheapest — do not propose a cheaper
tier to cut COGS.** This product sells the quality of one generated line; a mediocre reply
loses the user, and no per-call saving is worth a churned subscriber. The list prices in
`gateway.ts` exist so `costUsd` can be computed and a 6x move is visible — they are not an
argument for downgrading. **If spend needs bounding, the levers are `DAILY_CALL_CAP` and the
size of the free tier**, neither of which costs output quality. A Pro tier is not used
either: only preview IDs exist, and the user is watching a spinner while it runs.

**Changing `MODEL` is a real change, not config.** One line, then canary:
`cd backend && node --env-file=.env --import tsx src/ai/gateway.selfcheck.ts` catches both
failure classes (a model that rejects `thinkingLevel`, and truncation) under a deliberately
small cap. It cannot tell you the answer got *worse* — run a real screenshot through the Lab
and read it before promoting. Stable IDs sit in `gateway.ts` beside the constant.

**Gemini 3 cannot switch thinking off — but do not "buy headroom" for it.** `thinkingBudget:
0` used to mean zero; `thinkingLevel: 'low'` only means *less* (a six-line transcript still
measured `thoughtsTokenCount: 229`). Thinking counts against `maxOutputTokens`, so the
instinct is to raise the cap — don't. Gemini 3 sizes thinking as a *fraction* of the cap, so
it self-regulates: the same 40-line transcript measured thoughts=236/out=26 at 512 and
thoughts=404/out=26 at 2048. Raising the cap buys more thinking, latency and cost for an
identical answer. Measure with `usageMetadata` before changing any cap.

**The vault and scan history are DB-backed, and `db/schema.ts`'s "NEVER add" rule was
narrowed to allow it.** `profile_scans` (migration 0008) holds structured scan summaries;
`saved_items` (0009) holds lines the user bookmarked. Read that rule as it now stands:
**nothing the user gave us is ever stored** — no screenshot, no image bytes, no transcript, no
bio input — and only *output*, only on an *explicit* user act, may be. Nothing lands in either
table as a side effect. That is what keeps "screenshots and conversations are never saved" true
in `analyzer.tsx` and `account.tsx`. A third kind of user-scoped table needs docs/README.md
§5.4a rewritten before it is added, not after.

- **The client mints the id and it IS the server primary key.** `POST /v1/user/vault` upserts
  (`ON DUPLICATE KEY UPDATE`), so re-saving is idempotent. Regenerate an id on sync and the
  user gets a duplicate they have to delete twice.
- ⚠️ **Anything savable gets `contentId()`, never `uid()`.** This rule shipped broken and the
  bug was exactly the sentence above: `feedEngine.ts` decorated each daily line with `uid()`,
  but the batch is generated once globally per day, so every refetch (sign-out, new day, cache
  miss) gave identical text a new id. The card then read as unsaved, the user tapped save, and
  the upsert INSERTED — two identical rows in the vault. `contentId(prefix, text)` in
  `utils/contentId.ts` is stable across launches and devices, which is what makes the upsert do
  its job; `contentId.selfcheck.ts` in `npm run checks` pins stability, collision-freedom and
  the 64-char `saved_items.id` ceiling. `uid()` stays correct for **analysis results** — a
  re-run is a genuinely new report and deserves a new row. The test is whether the same bytes
  can come back from the server twice. `hydrateVault()` carries a permanent dedupe pass that
  clears the pairs already in people's vaults.
- **Sync helpers live in `services/userApi.ts` and go through `authedFetch`,** never through
  `callApi` (which sits on top of session identity and carries the AI envelope) and never
  through a bare `fetch`. `authedFetch` lives in `services/auth.ts` because it is the one
  thing allowed to mint and refresh a token; it attaches the bearer header and **retries once
  on 401**. That retry is the reason it exists: all eight helpers used to hand-roll the fetch
  with no refresh, so an expired token silently stopped the vault, coach answers and scan
  history from syncing, and every failure was swallowed into the `null`/`false` callers read
  as "offline". Each helper still returns `false` instead of throwing and still returns early
  when `isLiveApi` is false, so the vault works offline; the remaining cost is that a failed
  write is silent until the next fetch.
- **The readers answer `null` for "could not ask" and `[]` for "the server says empty",
  and callers MUST honour the difference.** `fetchVault()` and `fetchScans()` return `null`
  when offline, when the token bounces and in mock mode. Both used to flatten every one of
  those to `[]`, so every call site guarded on `items.length > 0` — which meant a vault or a
  scan list emptied on another device could never sync, and (on the scans path, which re-runs
  on every screen focus including the return from the paywall) a failed fetch wiped history
  the user was looking at. Never reintroduce a `.length > 0` guard: the empty array is the
  answer, `null` is the absence of one.
- **`hydrateVault()` in `useRizzStore.ts` is the only vault hydration path.** The store calls
  it on account change and `vault.tsx` calls it on mount. It existed twice, in near-copies
  that had already drifted — one compared before writing, the other did not.
- **`GET /v1/user/scans` caps at 20; `GET /v1/user/vault` caps at `VAULT_PAGE` (500) and says
  so with `has_more`.** The flag is load-bearing, not informational: `hydrateVault()` REPLACES
  the local copy, and replacing a 600-line vault with the newest 500 would delete 100 lines off
  the user's device that still exist on the server. When `has_more` is set it merges instead,
  server rows winning on id. Raise the cap freely; do not drop the flag, and do not add a caller
  that ignores it. The query is unpaginated by design — the client mirrors the whole vault into
  MMKV — so the cap is a bound on one response, not a page cursor.
- **`vault.tsx` renders the whole list**, which is why it is the one list carrying explicit
  `initialNumToRender` / `maxToRenderPerBatch` / `windowSize` bounds, and no `getItemLayout`
  (saved lines are variable height; a wrong fixed height desynchronises scroll from content).
  Do not "tidy" those props away.
- **Foreign keys with `ON DELETE CASCADE` land in migration 0011** on `profile_scans`,
  `saved_items` and `credit_events`. Until that migration is applied everywhere, keep adding
  every new user-scoped table to the `DELETE /v1/user/me` transaction by hand — nothing fails
  if you forget, the rows just outlive the account. Once it is applied, the database enforces
  what that comment used to ask you to remember, and the hand-written deletes become
  belt-and-braces rather than the mechanism. Do not remove them in the same change that adds
  the constraints.
- **`deleteAccount()` clears BOTH lists, and both are load-bearing.** It cleared only
  `scanHistory` once: the server rows were gone but the MMKV copy of the vault survived, so the
  next anonymous install on that device opened the Vault and read the deleted account's saved
  lines. It uses `setState`, not the store actions — `clearVault()` mirrors to the API and the
  token has already been dropped by then, so it would fire a 401 at a row that no longer exists.
- **Both server writes belong to the STORE, not to a screen.** `removeSaved`/`clearVault`/
  `toggleSave` and now `removeScan` each delete their own server row. `profile.tsx` used to call
  `deleteScan()` itself, which made the sync a property of one screen: a second caller of
  `removeScan` would drop the local copy and leave the row alive forever with nothing to notice.
  Same failure shape as the `analysisCount` double-write. Do not add a second call at a call site.

**Mock seeds are DEMO MODE ONLY — this used to say otherwise and the code moved first.**
All three AI engines are now `if (!isLiveApi) return simulate…; return viaApi(…)`: with an
API configured a failure THROWS and the screen toasts, because substituting a seed for a
failed call meant a user scanning their own profile got a report about "Maya, Bristol 26"
saved into their history as real. The one remaining fallback is `feedEngine`, which returns
`[]` so Discover falls back to the CURATED feed — content degrading to other content, not a
fabricated analysis of something the user supplied. Leave that one alone.

What is still true: with no `EXPO_PUBLIC_API_URL` every engine serves seeds and the app
demos fully offline, so canned output means "no API configured", not "the API failed".

**`callApi` VALIDATES the response before returning it — `services/contracts.ts`.** `src/types.ts`
and `backend/src/ai/schemas.ts` describe the same payloads in two languages, kept in step by
hand, and the cast in `callApi<T>` enforced nothing. The backend deploys separately from an OTA
and an installed build cannot be rolled back, so a field renamed server-side reached the
renderers as `undefined` and painted blank cards with no error anywhere. A mismatch now throws
`ApiError('SCHEMA')`, which lands in the mock fallback the engines already have — a visibly
canned result plus a toast, and a Crashlytics trace. **Check only what a renderer dereferences
unconditionally:** stricter than the UI turns a cosmetic server change into a user-facing
failure, looser is the blank card again. Optional fields stay unchecked, `isProfile: false` must
pass carrying none of the report, and an unknown route passes so a fifth engine is not blocked
by a guard nobody wrote yet. Hand-written, not zod — a bundle dependency for one yes/no question.
Guarded by `contracts.selfcheck.ts`, which is in `npm run checks`.

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

**`gemini.ok` now carries `costUsd`, and that is the line to watch.** Tokens were always
logged; the number that actually moved in the incident above was the price *per* token, and
nothing in the service expressed a call in money, so a 6x change was invisible for weeks.
The estimate comes from a hardcoded `PRICES` table in `gateway.ts` — a smoke alarm, not an
invoice. Keep it in step when `MODEL` changes; an unpriced model logs no cost rather than a
wrong one. Grep `gemini.ok` and sum `costUsd`; there is deliberately no rollup table yet.

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
replies look free forever. `consumeChatUsage()` and `ChatEntitlement.consumePending` are gone —
nothing ever wrote the counter they drained, so both sides read a permanent 0. An offline queue
would add its own drain.

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

**Nothing but routes may live in `src/app/`.** It is the Expo Router tree, so a helper
component dropped beside a screen becomes a navigable route — `app/account/AuthForm.tsx`
would be reachable at `/account/AuthForm`. The pieces split out of `account.tsx` and
`profile.tsx` are in `components/` for that reason, not for tidiness:
`components/feature/AuthFields.tsx` (`CredentialFields` + `CodeStep` + `Field`) and
`components/feature/ScanReport.tsx`. The screens keep the shell — hero copy, tabs, error row, CTA —
because each of those reads three or four flags at once (`isSignup`, `step`, `useCode`,
`isOnboarding`) and passing all four down to render one line of text is not a component.

**`account.tsx`'s state stays in `account.tsx`.** Splitting the fields out was worth it;
lifting the eleven `useState`s into a `useAuthForm()` hook is NOT — the hook would return
about twenty values the screen immediately destructures, which relocates the coupling
instead of reducing it, and it would put the documented `setBusy(false)`-is-not-a-`finally`
subtlety behind an indirection. Leave it.

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
moment. The 3s timer is a dead-man's switch only: if neither gate mounts, a flash beats a
splash that never lifts.

**Leaving the gate is the one exception, and it is a `replace`, not a push.** Declaration
alone gets you ONTO `/account` but never off it: `/welcome` un-declares itself when its
flag flips, so the navigator falls back — `/account` cannot, because it is also the modal
opened from the Profile Scan row and so stays declared for ever. Nothing pops it. Without
the `router.replace` in `_layout.tsx` a successful signup declared `/onboarding` behind a
gate the user was still looking at, and the CTA span until they force-quit. It waits on
`coachResolved` for the same reason the guards do — replace any earlier and it targets a
route that is not declared yet — and on `onboardedThisSession` so opening the account modal
while signed in does not trip it. `replace`, never `push`: the gate must not stay on the
stack behind the app.

**`welcome.tsx` now sits one step in front of the gate and uses the identical technique.**
`/account` is itself wrapped in `<Stack.Protected guard={welcomeStepDone}>`, so on a cold
install `/welcome` is the entire app, and its CTA sets a flag rather than navigating —
un-declaring one screen and declaring the next in one commit. Two consequences to preserve:

- **`/welcome` is guarded on `!welcomeStepDone`, not merely declared first.** A
  permanently-declared first route stays the navigator's fallback for ever, so a user who
  watched the demo and has no account yet would fall back onto the demo instead of signup.
  Declare-first is necessary but not sufficient; the negative guard is the other half.
- **`welcomeStepDone = hasSeenWelcome || accountStepDone`**, and the second half is load-
  bearing. Without it every existing install upgrading into this build gets a demo of an app
  it already uses, and the no-API build shows a demo of a signup gate that never appears.

`welcome.tsx` owns `hideAsync()` on the cold-install path now, for the same reason
`account.tsx` owns it on the signed-out one: whichever screen is actually the current gate
lifts the splash on its own mount. Both call it; only one of them is ever mounted first.

**…except while `SplashIntro` is up, and then IT owns `hideAsync()`.** The animated splash
(`components/feature/SplashIntro.tsx`) is an overlay rendered above the navigator, so it is what the
user is looking at; if a gate screen lifted the native splash first, there would be a frame of
whatever the navigator had painted before the overlay covered it. All three call it — the gate
screens are the fallback for any launch that skips the intro, and hiding an already-hidden
splash rejects harmlessly.

⚠️ **`SplashIntro`'s first frame must be pixel-identical to the native splash**: same
`palette.ink` ground, same `splash-icon.png`, same `LOGO = 150` width, same centre. Those four
are duplicated from the `expo-splash-screen` plugin block in `app.json` and **must be changed
together** — change one and the logo visibly jumps at the handoff, which reads as a rendering
bug, not an animation. It is also why the logo only ever translates, never scales, and why the
lockup's scale-to-fit is driven off the slide rather than applied at rest: the handoff frame is
still 1.0, and by the time it is scaled the thing is visibly moving.

**Cold launch only, and the mechanism is `useState(true)` in `_layout.tsx` — not a flag.** The
layout mounts once per JS context, and a warm resume does not remount it, so the intro cannot
replay. Do not add a persisted flag or a timestamp comparison; there is nothing for them to fix.

**The wordmark is a PNG, not a font.** Clash Display is free for commercial use in apps, but
the Fontshare EULA forbids modifying the font software (so it cannot be subsetted) and grants
embedding only in read-only documents, while explicitly permitting its use to "create logos and
other graphic elements [and] static images". A rendered wordmark is inside that grant; an
extractable `.ttf` in an APK is not clearly inside it. **Do not add the font file to the repo.**
Regenerate the asset with `docs/wordmark.py`, and if its pixel size changes, update
`NAME_RATIO` in `SplashIntro.tsx` — the whole lockup geometry is derived from it. `expo-font` is
in `package.json` and deliberately unused: an async font load gating the splash animation would
make the splash take longer in order to look nicer.

**`ICON_PAD_RIGHT` is measured from `splash-icon.png`'s alpha bounding box, not chosen.** The
icon is a 512×512 canvas with the mark inset — bbox (75, 39)–(432, 471), so 80px of the width,
a full 15.6%, is transparent padding on the right edge alone. At `LOGO = 150` that is 23pt of
invisible space between the visible mark and where the layout thinks the logo ends, which is why
a 14pt margin once rendered as a ~37pt hole and the lockup read as two unrelated objects. Hence
`LAYOUT_GAP = GAP - LOGO * ICON_PAD_RIGHT`, which is legitimately negative. **Re-export the icon
with different padding and this must be re-measured.** The wordmark has no such slack —
`docs/wordmark.py` crops to alpha, so its left edge is ink. `GAP` is the only number to turn if
the spacing still looks wrong; everything else derives from it.

**Both splash springs are overdamped (ζ slightly above 1), and that is deliberate.**
ζ = damping / (2·√stiffness) at reanimated's default mass of 1. They were previously ζ≈0.95 and
ζ≈0.47, so both rang — the logo passed its mark and came back, the mark bounced. On a splash the
eye has nothing else to look at and reads that as the layout settling late rather than as
personality.

**Both demos are scripted animations and must stay so.** Not bundled video — install size,
a re-export required for every copy change, no translation, and letterboxing on any aspect
ratio it was not exported for.

**All four pages go through `Page`, and no page invents its own arrangement** — including the
two demos. Visual, kicker,
title, body, facts, spacer — in that order, with the visual at one shared `visualHeight()` so
the copy block starts at the same y on every page. This is a fix, not a preference: the tour
pages put the image on top with copy beneath while the demo page put its title on top with the
chat beneath and a dead black band under that, and swiping between them read as two different
screens stitched together. The demo's chat card derives its height from the same function minus
`CARD_CHROME`, so a hardcoded number there silently breaks the alignment.

The ratio and clamps in `visualHeight()` are budgeted against the copy and footer, not chosen by
eye — the note there does the arithmetic. Raise them and the facts row slides under the CTA on a
small phone, where nothing scrolls vertically and so it is simply lost.

⚠️ **The demo ends at "Copied", never "Pasted" or "Sent".** `RizzAccessibilityService` calls
`copyToClipboard(result.reply)` and toasts "✨ Reply copied — paste & send"; it never writes into
the host app and never sends. An earlier version of this screen typed the reply into her chat's
composer and said "Pasted in. Send it." — advertising an autonomous action, which is the exact
capability the Play accessibility declaration says the service does not have. That is why the
result renders as our own sheet **over** her composer rather than inside it: two surfaces,
visibly separate, because that is what actually happens.

**The demo thread is a real back-and-forth with history, and the scan pass is the point.**
Not one orphan message: what is being demonstrated is *context*, and a tool that only read the
last line could not know about the running joke, so its reply would be indistinguishable from a
generic opener. The thread is deliberately taller than its clipped, bottom-aligned box — the
oldest messages fall off the top behind a fade, which is what makes it read as a conversation
already in progress. During `think` a violet line sweeps the box and each bubble's border lights
as it passes; a line sweeping over *static* bubbles reads as a loading bar, bubbles reacting to
it read as something being taken in. Two constants there are load bearing and are documented at
their definitions: the highlight window is bounded away from both ends of the sweep (or the top
message sits permanently outlined at rest, and the bottom one loses a half-lit border in a
single frame), and the border is always drawn with only its colour animating (or every bubble
twitches a pixel wider as the line reaches it).

**The read scrolls the thread back and then returns it, because the service does.**
`RizzAccessibilityService` scrolls the user's chat backward `CHAT_SCROLLS = 3` times, reading
between each step, then scrolls forward again — and `analyzer.tsx` warns the user they will see
their screen move, because an app scrolling by itself with no warning reads as possession rather
than as a feature. The demo's `think` phase is one linear clock carved into three beats: scroll
back (0–0.3), sweep the revealed history (0.3–0.8), scroll forward again (0.8–1). **Keep the
return leg.** A demo that read the history and left her scrolled up would show worse behaviour
than the app actually has. `think` is the long phase for the same reason — 3 × `SCROLL_SETTLE_MS`
is 1.35s of real scrolling before the request is even sent, so a snappier version would
misrepresent the wait.

**The reply carries one of her emoji, and that is a demonstration, not decoration.**
`prompts.ts` tells the model to mirror the user's voice — "capitalisation, punctuation habits,
**emoji use or total lack of it**, slang, and typical message length". A clean, formal reply
dropped into a thread full of 😭 and 👀 is precisely what makes a generated line read as
generated, so the demo must not show one. One emoji, not three: the same file says "no emoji
spam". If that mirroring instruction is ever removed, this copy changes with it.

The demo copy ships in store-listing screenshots. Keep it flirty, keep it clean, and keep it
obviously fictional — no real handles, no real conversations.

**The order is Bio Lab · the Lab · Profile Scan · chat, and all four are demos.** No stills
remain. The order is a widening claim: two things you do *inside* the app, then two things it
does *inside theirs*. The pages are a `ScrollView pagingEnabled` so swipe is free; the CTA and
dots sit **outside** it, or the button slides off screen mid-swipe.

**The Vault is deliberately not one of the four.** It was a still here and lost its page to the
Lab. A screen shown in front of the signup gate has to earn itself against the tab a new user
actually lands on, and the Vault is somewhere you go once you already have lines worth keeping.
It survives in `LAB_FACTS` as "Save what lands".

⚠️ **The sheet language carries what motion no longer can.** With every page moving, none of
them is the singular payoff by contrast, so the *type* of reveal has to do that work and the
three kinds mean three different things:

| page | reveal | because |
|---|---|---|
| Bio Lab, the Lab | content swaps **in place** | one screen changing its own state — which is what `bio.tsx` and `(tabs)/index.tsx` do |
| Profile Scan | sheet covers the **whole card** | `launchApp()` — RizzCoach came to the foreground |
| chat | sheet covers **only the composer** | our surface over someone else's app |

Do not reach for a sheet on pages 0–1 because it looks better. **The ✨ appears only on pages
2–3** for the same reason: it is the app's one signature gesture, and on four pages it stops
meaning anything specific.

**Both loops go through `usePhaseLoop`, and both are gated on `live`.** One hook, because the
two things that are easy to get subtly wrong have to be decided once: an ungated loop runs a
timer and a re-render behind the other pages from the app's first frame, and a loop that starts
before `AccessibilityInfo` has answered shows the opening frames of an animation the user has
asked never to see (`reduceMotion` is `null` until it answers — check `!== false`, not
`!reduceMotion`). Under Reduce Motion the hook holds each demo's **last** phase, so those users
get the payoff frame rather than an empty chat or an unscanned profile.

### The Bio Lab and Lab demos

**Both replay their real screen's own flow, in its own order.** Bio Lab fills in `BioInput` —
`interests`, then `vibe`, then the `BioResult` — and the Lab runs a screenshot through
`ANALYZE_STAGES` into `ReplyOption`s. The stage lines are **imported** (`ANALYZE_STAGES`,
`PROFILE_STAGES.them`), never retyped, so the first real run shows the same words in the same
order the demo did.

**`INTERESTS` lives in `data/interests.ts`, not in `(tabs)/bio.tsx`.** Both screens read it, and
a retyped copy would leave onboarding advertising a chip the app no longer has. It is not
imported *from the route* because that would drag `BioScreen`'s whole dependency graph onto the
cold-start path — welcome is the first screen a fresh install renders.

**Each loop shows a different example, and `usePhaseLoop` returns the `cycle` count that
selects it** — three combinations on Bio Lab, two screenshots on the Lab. A loop that replays
identically is the moment a user decides they have seen it, so the second watch has to pay.
`cycle` is bumped on the WRAP, not on mount, so the first pass is always variant 0 and which
example a user meets first does not depend on timing. Bio Lab's three `label`s cover all three
of `BioTone`, so watching twice shows the range rather than one voice with different nouns.

⚠️ **Every bio must be traceable back to its own three chips, and every reply must answer the
last line of its own thread.** That traceability is the entire claim both pages make — a bio you
cannot trace back to what you tapped is a template, and a reply that would work under either
screenshot demonstrates exactly the thing the page argues against. Change a pick, change the
bio. Picks are named by label rather than index so reordering `INTERESTS` cannot silently change
which chips light up.

Both variant lists are typed with **tuples, not arrays** (`BioVariant.picks`,
`LabVariant.replies`), so the counts are compile errors rather than device-only surprises:
`BIO_HOLD.pick` is paced against exactly three chips, and a variant showing two replies would
read as the model having found only two answers.

⚠️ **The Lab demo says "Pick a screenshot", never "take" or "record".** The app opens the photo
library via `ImagePicker`; it has no camera path and does not capture the screen. It also shows
**all three** replies with their `spice` pips filled to level — the choice between three styles
is the feature, and `spice` is a 1–3 scale that needs its own maximum on screen to read as one.

### The Profile Scan demo

⚠️ **The RizzCoach sheet covers the WHOLE card, and the chat demo's sheet deliberately does
not.** That asymmetry is the product, not styling. A bubble tap on a profile runs
`onAnalyzeTapped` → screenshot → `CaptureStore` push → **`launchApp()`**: RizzCoach comes to the
foreground and renders the report itself, so the demo has to look like an app switch. The chat
bubble's result really is our sheet sitting over someone else's app, so that one is a partial
cover. Draw the profile report as a panel floating over the dating app and you have depicted the
service painting UI into another app and reading it back — wrong, and the exact capability the
accessibility declaration disclaims.

**A bubble capture is always mode `'them'`** (`profile.tsx`: `setMode(capture.mode ?? 'them')`),
so every label on that sheet comes from `PROFILE_LABELS.them` verbatim — "First Impression",
"Shared-Interest Signal", "Your best opening move" — and the loading lines are
`PROFILE_STAGES.them` imported, not retyped, so the first real scan shows the same words in the
same order. Two scores, never more: `ProfileScanResult` has exactly two `ProfileScore` slots.

⚠️ **It ends at "Tap to copy", not "Copied" — the opposite of the chat demo.**
`PROFILE_LABELS.them.linesHint` is "Tap copy to send one…": openers sit in the report until the
user takes one. The chat bubble auto-copies. Do not conflate the two.

**Nothing on this page promises a match.** `PROFILE_LABELS.them.disclaimer` is explicit that a
scan is "conversation prep — they're a whole human, not a score", and a first-run screen
promising odds would be contradicted by the first report the user ever opens. Sell openers that
get answered; that is what the report actually produces.

**The profile is invented art on our own bundled background, never a recreation of a real
dating app's card.** Same rule as the chat demo's phone mock — another company's trade dress in
our onboarding is also their trade dress in our store listing. A photo, a name and an age is all
the recognition the beat needs.

⚠️ **Every number and line on every page is hardcoded and must stay hardcoded.** This screen
runs before the account, before `aiConsent`, and before any credit could be charged, so wiring
any of it to a live engine would bill a user who has agreed to nothing. But the mock *shapes*
are real — scores out of 10 with a note (`ProfileScore`), labelled tone variants (`BioOption`),
Vault lines by category. Change one of those shapes and the mock changes with it, or the first
screen of the app is telling a lie about the rest of it.

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

Six codes now, and `account.tsx` branches on the code, not the message:

| Code | Status | When |
|---|---|---|
| `EMAIL_TAKEN` | 409 | `/otp` signup, or a signup race on `uq_users_email` |
| `USERNAME_TAKEN` | 409 | `/otp` signup, or a signup race on `uq_users_username` |
| `NO_ACCOUNT` | 404 | `/otp` login, or `/login` with an unknown address |
| `DISPOSABLE_EMAIL` | 400 | `/otp` **signup only** — a throwaway inbox |
| `WRONG_PASSWORD` | 401 | password branch only |
| `ACCOUNT_LOCKED` | 429 | 10 failures — **including the attempt that trips it** |

**`DISPOSABLE_EMAIL` is signup-only, and that asymmetry is load-bearing.** `lib/disposable.ts`
holds ~80 throwaway providers (yopmail, mailinator, guerrillamail, temp-mail…) and refuses
them before anything is looked up or mailed. It is checked at `/otp` and nowhere else,
because `/signup` will not write a row without a code only `/otp` issues — an address
refused there can never reach it. The `login` purpose is deliberately NOT checked: accounts
made before this rule exist, and refusing their recovery code would strand them with no way
in and no way to change the address.

⚠️ **Gmail, Outlook, iCloud, Yahoo, Proton and GMX must never go on that list.** This is a
consumer dating product; "professional email" here means an inbox the person *keeps*, not
one their employer owns, and a rule that only took corporate domains would refuse nearly
every real user on the mandatory gate with no way past it. `disposable.selfcheck.ts` asserts
exactly that — its allow cases are the point of the file, not its block cases. The list is a
speed bump, not a wall; add to it when a provider turns up in the users table.

`nudgeMode()` in `account.tsx` moves the user to the other tab on `EMAIL_TAKEN` /
`NO_ACCOUNT`, keeping what they typed. That is the whole point of naming them; an error
string they have to read and act on themselves is barely better than the silence.

**Both clashes are checked at `/otp`, before a code is mailed.** The email one always was;
the username one used to surface from `ER_DUP_ENTRY` inside `/signup`, which runs *after*
the user has waited for the mail, switched apps and typed six digits — so they were told to
pick another name at the one moment their code had just been burnt. `/otp` takes an
optional `username` for this (optional so an older client still works, just without the
pre-check), and `account.tsx` sends it on the signup path. The `ER_DUP_ENTRY` handler in
`/signup` stays as the race backstop and answers with **the same codes**, so the client
never has to learn two ways of being told the same thing; on `USERNAME_TAKEN` it returns to
the details step, since the field to fix is behind the code screen.

`usernameField` is one Zod schema shared by both routes. Two copies would drift, and the
failure mode is a name accepted at the pre-check and rejected after the code — exactly what
the pre-check exists to remove.

⚠️ **A username rejection still spends an `/otp` token.** The bucket is middleware and runs
before the handler, and `/otp` has the tightest one in the service because a call normally
means a paid email. This is also the only rejection a user *retries* — email clashes send
them to the login tab, so they never loop. Four attempts in a minute is more names than
anyone tries, but a live "is this name free" check as the user types must NOT call `/otp`
per keystroke; it needs its own route under the looser `/v1/auth/*` bucket.

**What still bounds enumeration:** the IP bucket on `/v1/auth/*` (`/otp` is 4 tokens
refilling at 0.02/s — about one probe every 50s per address), the per-account lockout, and
the fact that neither a password nor a mailbox gets easier to guess for knowing the address
is real. `dummyHash()` is no longer called by `/login` — it only ever existed to hide what
`/otp` now says outright — but it stays exported and selfchecked.

Usernames were always nameable — they are public, the account screen prints them back as
`@name` — which is why `USERNAME_TAKEN` costs nothing in enumeration terms: it confirms
what that screen already shows, and there is no inbox behind it.

**`lib/password.ts` is `node:crypto` scrypt and nothing else.** N=2^15 needs 32MB, which
is exactly Node's default `maxmem` — so `MAXMEM` is set explicitly and every call passes
it. Raise N without raising `MAXMEM` and every login 500s with
`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. Parameters are stored inside the hash, so N can be
raised later without invalidating existing rows. Guarded by `password.selfcheck.ts`,
which also pins the NFKC normalisation — the same accented character composes differently
on iOS and Android keyboards, and without it a password set on one platform fails on the
other, with no reset to recover from.

**`DELETE /v1/user/me` is not a feature.** App Store Review 5.1.1(v) requires in-app account
deletion, and Play requires a deletion path. Both halves now ship: the route is one
transaction over six deletes — `credit_events`, `idempotency` (`<user_id>:%`), user-scoped
`rate_limits`, `profile_scans`, `saved_items`, then `users` — and the Delete account button is
back in `account.tsx` behind the themed confirm dialog, disabled while in flight. It is
fronted by `requireAccount`, not plain JWT: a device token proves someone holds the install
id, not that they are the account holder. Hard DELETE, never a soft flag — the unique key on
`email` would block them signing up again.

Both leftovers this note used to carry are now closed. The route's doc comment was rewritten
and no longer claims "one statement is the whole implementation"; foreign keys with
`ON DELETE CASCADE` arrive in migration 0011. Until 0011 is applied on every environment,
the by-hand rule above still governs — see the bullet in the vault/scan-history section.

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

**`report_feedback` is the only quality signal this product collects.** The 👍/👎 on a scan
report used to write to MMKV and stop there — the icon lit up, the toast said "Thanks —
noted!", and nobody was noted. It now also fires `track({ name: 'report_feedback', engine,
value })`. The store write stays: it is what re-lights the icon on a report reopened from
history. **The event carries the engine and the verdict and nothing else** — not the report
id, not the mode, not a word of the output. The rule above is not relaxed for the one event
where the content would be most useful to have; a version that needs the text needs a
consented, deletable store, not this pipe.

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

**The activation funnel is `welcome_seen → gate_seen → first_result → account_* →
credits_exhausted`**, and each one is fired from exactly one place on purpose:

| Event | Fired from | Why there |
|---|---|---|
| `welcome_seen` / `welcome_done` | `welcome.tsx` on mount and on its CTA | The first frame after the splash, so it is the only event that counts *installs* rather than installs-that-reached-the-signup-form. `ms` separates "the demo sold it" from "the demo was an obstacle" |
| `gate_seen` | `account.tsx`, inside the `isOnboarding` branch | Opened as a modal from Profile Scan this is not a gate; counting it would pad the denominator |
| `first_result` | `callApi` in `services/api.ts` | One choke point that already knows the engine. `feed` is excluded — a background daily fetch is not activation |
| `account_created` / `account_login` | `account.tsx` `submit()`, after the await | Before the await it would count rejected attempts as conversions |
| `credits_exhausted` | `useCreditGate` | The moment the tier REFUSES someone, which is a different number from `paywall_viewed` — the gap is everyone who hit the wall and never read the offer |

`welcome_seen` is now the top of the funnel; `gate_seen` remains the denominator for signup
conversion but is no longer the denominator for install conversion. The gap between the two
is the demo's own drop-off, and it is the number that decides whether that screen earns its
place.

⚠️ **`first_result` needs `hasActivated` in `partialize`** or every launch re-reports the
user as newly activated. It is the only analytics flag that must survive a reload; a
reinstall correctly counts again, because that is a new install.

## Onboarding answers — `src/app/onboarding.tsx` → `coachParts()`

**Every question in the setup flow must change the model's output, in the same change that
adds it.** The three answers (`apps`, `struggle`, `style`) are persisted as `coach` on the
store, sent by Lab / Profile Scan / Bio Lab via `coachPayload()`, and turned into a user-turn
part by `coachParts()` in `backend/src/ai/prompts.ts`. A question whose answer is only stored
is three taps of friction in front of the paywall that buys nothing — and it fails silently:
the app works, the output is just generic. `backend/src/ai/prompts.selfcheck.ts` is the only
thing that notices.

**Never ask a returning user the questions again — ask the SERVER first.** The setup gate in
`_layout.tsx` awaits `refreshCredits(true)` rather than a timer, and re-reads `coach` from the
store in the callback. `adoptCoach()` in `useRizzStore` adopts the server's answers, but they
ride on `/v1/user/credits` only, and nothing forced that call after a login: the refresh effect
runs on mount and on resume, and on a fresh install the mount happens while there is still no
account to authenticate with. So the answers landed on the next resume at the earliest — long
after the push. Someone who answered months ago on another device reinstalled and was asked all
three again. **Do not put the timer back.** The re-read inside the callback is also required,
not defensive: `adoptCoach` writes the store from that very response, so the `coachStepDone`
captured in the closure is a snapshot from before it.

Offline resolves too, with `coach` still null, and then we ask — the right fallback, since three
questions is a smaller harm than an unpersonalised account and the answers upsert either way.

**The mirror of that rule: ALWAYS ask a genuinely new user, which means `coach` must be cleared
on sign-out.** It is persisted and doubles as the "have they done the quiz" flag, so it used to
outlive a sign-out — and the next account created on that device found `coachStepDone` already
true, was never asked, and got the previous user's `style` and `struggle`. Sign-out now goes
through `onAccountCleared` in `services/auth.ts` alongside delete, wiping `coach`, `savedItems` and
`scanHistory` together. The old reasoning ("the rows come back from the server on the next
login") only ever held for signing back into the SAME account; the vault leaked across accounts
in exactly the same way, since `fetchVault` keeps local rows the server page lacks and
`toggleSave` mirrors them up.

⚠️ **That wipe is account-owned state only.** `analysisCount` and `isPro` stay — they are
install-scoped for the same reason `logOut` keeps the install id, and wiping them would make
sign-out a way to reset the free tier.

**And it is wiped again on sign-IN, by `noteAccountEmail`, whenever the address differs from
the last one used on this device.** Two things make this necessary rather than belt-and-braces.
A wipe at sign-out cannot repair an install that has *already* signed out — every device that
signed out on an earlier build still carries the previous user's `coach`, and would hand it to
every account created on it from then on; this heals those on the next sign-in. And it does not
assume `logOut` is the only way the account can change, which is exactly the kind of assumption
that stops being true later.

`LAST_EMAIL_KEY` is the signal because it **survives sign-out** — by then the store's `account`
is null, so nothing else on the device can say who the local data belonged to. Compared
case-insensitively, or a capital letter wipes a vault. A fresh install has no previous address,
so nothing is wiped and an anonymous user's saved lines correctly survive their first signup.

Order matters and is load bearing: the wipe is synchronous and runs *after* `persistSession`,
so it lands before the `hydrateVault()` that sign-in kicked off resolves — the merge then sees
an empty local list and takes the server's rows alone. It also runs after `adoptCoach` has
declined to overwrite (the device still had the old answers at that moment), which is why the
gate's `refreshCredits(true)` is what finally adopts the *new* account's answers: it re-asks
with `coach` now null, so a returning user is still not re-questioned and a genuinely new one
is.

**Closed enums on both sides, and they are a wire contract.** `COACH_APPS`,
`COACH_STRUGGLES`, `COACH_STYLES` are zod enums on the server; `CoachApp`, `CoachStruggle`,
`CoachStyle` in `src/types.ts` are the same strings. Renaming one side only does not 400 — the
server drops the unknown value and the user quietly loses personalisation. Change both.

**`backend/src/lib/coach.ts` is the only validator and the only writer of `users.coach_json`.**
`Coach` (the zod schema), `rememberCoach()` (the write) and `storedCoach()` (the read-back)
live there, and both routes that touch the column import them: the AI engines write it
opportunistically as a side effect of an analysis, `POST /v1/user/coach` writes it for the
onboarding screen, which has the answers before it has run anything. They disagreed until P2 —
`/v1/user/coach` parsed `z.string().max(64)` per field and issued its own `UPDATE`, so it
accepted values the enums do not define and could overflow `VARCHAR(255)`, which MySQL
truncates mid-string into JSON that never parses again. Adding a third writer means importing
`rememberCoach`, not writing a fourth `UPDATE`. `backend/src/lib/coach.selfcheck.ts` asserts
the enums reject unknown values and that the widest legal payload still fits the column — so
adding an app or a longer style key fails there rather than in production.

**It rides in the user turn, never the system instruction.** Same rule as `ui_text`, plus one
more: `promptVersion()` hashes and memoises the system string, so a per-user system prompt
would mint a prompt "version" per answer combination and destroy the cost and quality
attribution that hash exists for.

`coach == null` is what makes the onboarding modal appear — there is no separate "has done the
quiz" boolean, because two sources of truth for one question eventually disagree. It is cleared
on account deletion; the next person on this install is a different person.

The native chat bubble does not send it. `GeminiChatClient.kt` posts `transcript` and `tone`
only, and adding a field there is a rebuild, not an OTA.

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

**The privacy policy's strongest claims are enforced by `db/schema.ts`, not by prose.**
Screenshots, message text and bios are never stored, which is true because there is nowhere to
put them — **that half is absolute and is the one that is not negotiable.** The policy was
reworded to match migrations 0008/0009: it now says plainly that we never store what you *give*
us, that we do keep results you asked us to keep (a scan you ran, a line you saved), that
nothing is stored as a side effect, and that the idempotency cache holds an answer for a few
minutes so a retry does not charge twice. Sections 1, 2, 6 and 7 all changed together — **if you
add a table, all four have to move again.**

**The pages carry no "last updated" date**, by request. Nothing in the copy may refer to one
(section 10 said "this page and the date above" and had to be reworded when the date came out),
and there is no version marker to bump — so a substantive edit here is invisible to a user who
read the old version. If a reviewer or a jurisdiction asks for a date, it goes back in `page()`.
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
- **A raw `fontSize` is an ESLint error, and that is not negotiable by adding a disable.** Pick
  one of the twelve roles in `type` (`display · hero · h1 · h2 · h3 · reply · body · bodyMuted ·
  bodySm · label · caption · overline · micro`), spread it, and override nothing but `color`
  and `fontWeight`. Emoji take `glyph`, which exists precisely so the rule needs no exceptions.
  This half of the token rule was ignored for a long time and the cost was visible: **215 raw
  declarations across 31 distinct sizes** — 14.5, 12.5, 11.5, 16.5, 15.5, 13.5, 10.5 — which is
  why the app read as slightly different on every screen while every individual screen looked
  fine. Two files are exempt in `eslint.config.js` and only two: `theme/` defines the sizes, and
  `screens/welcome/styles.ts` is a scale model of a phone drawn inside a card, where its
  overrides still sit on top of a token. If a new size feels necessary, add a *role* to `type`
  with a reason — do not reintroduce a number.
- **A raw `.duration(<number>)` is an ESLint error too, same rule and same reason.** Pick one of
  the four roles in `theme/motion.ts` — `instant` (120, confirming a touch) · `quick` (200,
  something small arriving) · `standard` (280, the default) · `deliberate` (420, the reveal
  after a wait) — or `EXIT` (160) for anything leaving. Twelve hand-picked millisecond counts
  were in the tree before this and nobody had decided that a toast took 250ms and a card 260;
  that is one intention typed twice. **`screens/welcome/**` is exempt in full**, because its
  600 and 700ms ripples are beats in a choreographed demo synced to the phase holds in
  `shared.tsx`, not durations somebody failed to tokenise. Retiming them desynchronises the
  demo to make a grep look tidy.
- **`Button` and `Chip` are the two shapes, and neither is optional.** Seven hand-built CTAs
  and four hand-built pills existed before them, all at different heights. `Button` owns label
  colour per variant (`accent` fills are light and take ink; `primary` is violet and takes
  white) — the caller never passes it. `Chip` has `sm` for filter rows you scan, which carries
  `CHIP_HIT_SLOP` so a 30pt pill is still a 44pt target, and `md` for a choice you make, where
  the pill IS the target. `overImage` is a real variant, not drift: Discover's filters float
  over a photo and need the darkened ground. The two gradient CTAs in `paywall.tsx` and
  `LockOverlay.tsx` stay outside `Button` — they are cinematic by design, and folding them in
  would drag gradients and shadows into the primitive to serve two call sites.
- **`palette.scrim` is the modal backdrop; `palette.surfaceInset` is anything recessed.** The
  elevation model had no way to say "below ground", so an input well had to borrow
  `surfaceHigh` — the token for something *raised* — and every text field read as a button.
  `LockOverlay` deliberately keeps a lighter veil than `scrim`: it is selling the feed behind
  it, and hiding that removes the reason to unlock.
- **State colours come from `semantic`, not from the brand palette.** `gold` was simultaneously
  "the bubble was killed, act on this" and "this line is a Closer"; one entry with two meanings
  is how the next person picks the wrong one. `semantic.{success,warning,error,info,disabled}`
  for status, raw brand colours for fills, category tints and gradients.
- **`type.reply` is for generated text — a reply, a bio, a saved line, a roast, a scan summary.**
  It is the one role at 17/25 regular, and it exists so what the user sends is never rendered in
  the same style as the UI describing it. Do not use it for chrome.
- All touchables route through `HapticPressable` so touch feel stays consistent.
- **Destructive actions confirm through `components/ui/ConfirmDialog.tsx` — never `Alert.alert`,
  never a new local `<Modal>`.** Five of them delete a *server* row: remove a saved line,
  clear the vault, forget a scan, delete the account. The dialog is the only thing between a
  mis-tap and data that is gone. The native alert renders in the OS palette (white sheet, blue
  text, ALL-CAPS Android buttons) inside a dark app and cannot read `tokens.ts` at all.
  `vault.tsx`, `profile.tsx` and `account.tsx` each carried their own copy of the same ~40
  lines of scrim/dialog styles; that is now one component and the copies are deleted. Pass
  `busy` for an async confirm — it disables both buttons, spins the danger one, and blocks
  scrim-tap and Android back, because dismissing a confirmation whose request is already in
  flight tells the user it did not happen. Extend it with a prop; do not fork it.
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
- Free-credit gate: `useOutOfCredits()` from the store. Don't re-derive it. **To BLOCK on it,
  call `useCreditGate()`** (`hooks/useCreditGate.ts`) — `if (gate('out_of_credits')) return;`
  does the haptic, the paywall push and the attribution. The rule was written longhand at four
  call sites, and the last freemium rule that lived at its call sites (`analysisCount`) drifted
  silently and cost every free user a third of their trial. `source` is a required argument, not
  optional: it rides in as the route param `paywall.tsx` logs, so a call site that omits it is a
  hole in the funnel rather than a visible bug.
- **The staged "thinking" ticker is `useStagedProgress(stageCount, intervalMs)`.** All three AI
  tools had their own `stage` state, `stageTimer` ref, interval, `clearInterval` in a `finally`
  and unmount cleanup — five parts each, where a missed cleanup leaks a timer that calls
  `setState` on an unmounted screen and costs nothing until it cannot be reproduced. `start()`
  restarts rather than stacking a second interval, and takes an optional count for Profile Scan,
  whose stage copy is per-mode and whose mode can be set by a bubble capture at run time.
  It owns the timer and NOTHING else on purpose: the three runs genuinely differ — the Lab
  charges once per screenshot and keeps the report up when a reroll fails, Profile Scan can come
  back "not a profile" and must not count it — and folding those in means a hook with a flag per
  screen. Do not grow this into a `useRunAnalysis`.
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
