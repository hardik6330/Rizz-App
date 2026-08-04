# RizzCoach — the whole app, in one document

Start here. This is the only document you need to understand RizzCoach — what it does, how it
is built, where every file lives, how to ship it, and what breaks.

**New to the repo?** Read §1 (what the product is) and §2 (the folder tree — every file with a
one-line job). That is enough to find your way around. The rest is reference: come back to it
when you touch that part.

`AGENTS.md` at the repo root is the companion. This file explains **how the pieces fit**; that
one lists **the rules you must not break while editing**. When they disagree, `AGENTS.md`
wins — it sits next to the code.

| | | | |
|---|---|---|---|
| [1 · The product](#1--what-the-product-is) | [4 · The AI path](#4--the-ai-path) | [7 · Monetization](#7--monetization) | [10 · Checks](#10--checks) |
| [2 · Folder tree](#2--repository-layout--every-file-and-what-it-does) | [5 · The backend](#5--the-backend) | [8 · Analytics & privacy](#8--analytics-and-privacy) | [11 · Testing the analyzer](#11--testing-the-android-analyzer) |
| [3 · The client](#3--the-client) | [6 · The Android bubble](#6--the-android-analyzer-the-actual-moat) | [9 · Shipping](#9--shipping) | [12 · Debugging table](#12--debugging-table) |

---

## 1. What the product is

An AI dating-conversation coach for Android and iOS. The user gives it a screenshot; it gives
back something they can paste into a chat.

Four tools, one credit pool:

| Tool | Input | Output |
|---|---|---|
| **Lab** (Screenshot Scan) | a chat screenshot | 3 replies (Smooth / Playful / Bold), a vibe read, or a roast |
| **Profile Scan** | 1–3 profile screenshots | a scored coaching report, or openers for someone else's profile |
| **Bio Optimizer** | interests + a target vibe | 3 rewritten dating-app bios |
| **Discover** | nothing | a daily feed of opening lines, swipeable |

Plus the feature the rest of the product exists to support: an **Android bubble** that floats
over Instagram/Tinder/Bumble/Hinge and writes the next message *without leaving the app the
user is already in*.

Free users get **3 lifetime analyses** across all AI tools and **10 swipes/day** in Discover.
Pro is a RevenueCat subscription.

---

## 2. Repository layout — every file and what it does

Three deployables in one repo: the Expo app (`src/`), the API (`backend/`), and one Android
native module (`modules/profile-capture/`). They ship on different schedules — see §9.

```
RizzCoach/
│
├── app.json                    static Expo config — `version` IS the runtimeVersion
├── app.config.ts               layers over app.json; widget + Firebase attach only if keyed
├── eas.json                    build profiles: preview · simulator · production
├── AGENTS.md                   the editing rules (CLAUDE.md just includes it)
├── .env                        local dev only, gitignored — builds read the EAS environment
├── android/  ios/              NOT IN GIT — CNG regenerates them every build
│
├── src/                        ─────────────  THE EXPO APP  ─────────────
│   │
│   ├── app/                    screens (Expo Router — the file tree IS the routes)
│   │   ├── _layout.tsx           root: theme, purchases, credit reconcile, native snapshot push
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx         the four tabs, drawn by FloatingTabBar
│   │   │   ├── index.tsx           ▸ LAB — chat screenshot → replies / vibe / roast
│   │   │   ├── profile.tsx         ▸ PROFILE SCAN — self & them modes, tabbed report, history
│   │   │   ├── bio.tsx             ▸ BIO OPTIMIZER — the only screen with text inputs
│   │   │   └── discover.tsx        ▸ DISCOVER — daily feed, swipe limit, lock overlay
│   │   ├── paywall.tsx           plans + purchase + restore; ALL paywall analytics live here
│   │   ├── vault.tsx             saved lines (full-screen modal on Android)
│   │   ├── analyzer.tsx          disclosure + the two-permission flow for the bubble
│   │   └── +not-found.tsx
│   │
│   ├── components/             21 shared UI pieces
│   │   ├── HapticPressable.tsx   the base touchable — everything routes through it
│   │   ├── ScreenHeader.tsx      wordmark + credit meter + vault, on all three AI tools
│   │   ├── GlowDropZone.tsx      the breathing screenshot drop pad
│   │   ├── StagedLoader.tsx      text-only "thinking" card (Bio, Profile)
│   │   ├── AnalyzingOverlay.tsx  beam sweep over the picked image (Lab)
│   │   ├── ReplyCard · ABSimulator · VibeCheckCard · RoastCard        Lab results
│   │   ├── FeedCard · ActionRail · LockOverlay                        Discover
│   │   ├── LimitBadge · ProUpsellCard · PlanCard                      monetization
│   │   ├── VaultItem · EmptyVault                                     vault
│   │   └── FloatingTabBar · ModeSelector · CircleIconButton · Toast   chrome
│   │
│   ├── services/               everything that talks outward
│   │   ├── api.ts                ★ callApi — the ONLY path to the backend
│   │   ├── engine.ts             Lab       →  POST /v1/ai/lab
│   │   ├── profileEngine.ts      Profile   →  POST /v1/ai/profile
│   │   ├── bioEngine.ts          Bio       →  POST /v1/ai/bio
│   │   ├── feedEngine.ts         Discover  →  GET  /v1/feed
│   │   ├── analytics.ts          track() over a FIXED event union — never free-form
│   │   ├── purchases.ts          RevenueCat
│   │   └── widgetBridge.ts       iOS home-screen widget (no-ops without the module)
│   │
│   ├── state/
│   │   ├── useRizzStore.ts       Zustand + MMKV — persist ⇒ add it to `partialize`
│   │   ├── session.ts            install id, JWT, isLiveApi, syncPro, refreshCredits
│   │   ├── limits.ts             swipe allowance + isLiveRevenueCatKey
│   │   ├── storage.ts            the MMKV instance
│   │   └── limits.selfcheck.ts   ✓ runnable
│   │
│   ├── theme/
│   │   ├── tokens.ts             colour · type · spacing · radii
│   │   ├── layout.ts             gutter · tab-bar clearance · card heights · font scale
│   │   └── contrast.selfcheck.ts ✓ runnable — WCAG AA vs tokens.ts
│   │
│   ├── data/                   mockAnalysis.ts · feed.ts · assets.ts   (offline seeds)
│   ├── utils/                  useBackToIdle.ts · haptics.ts · misc.ts
│   ├── constants.ts            FREE_ANALYSIS_LIMIT (3) · FREE_SWIPE_LIMIT (10)
│   └── types.ts                result shapes — must match the server schemas exactly
│
├── backend/                    ─────────────  THE API  ─────────────
│   └── src/                    Hono · Vercel · Railway MySQL · owns the Gemini key
│       ├── index.ts              local dev server
│       ├── vercel.ts             ⚠ hand-rolled entrypoint — both Hono adapters hang
│       ├── app.ts                routes, middleware ORDER, error envelope, boot guard
│       ├── env.ts                validated config — EXITS rather than half-boot
│       ├── ai/
│       │   ├── gateway.ts          ★ the one place that calls Gemini
│       │   ├── prompts.ts          every system prompt + the safety-rail boot guard
│       │   ├── schemas.ts          responseSchema per engine (uppercase OpenAPI)
│       │   └── gateway.selfcheck.ts    ✓ one tiny LIVE call
│       ├── routes/               auth.ts · ai.ts · user.ts · config.ts
│       ├── middleware/           auth.ts · credits.ts · rateLimit.ts
│       │   └── credits.selfcheck.ts    ✓ runnable
│       ├── db/                   schema.ts (users · daily_feed · rc_events) · client.ts
│       ├── lib/                  logger · errors · jwt · limits · revenuecat
│       └── vercel.selfcheck.ts   ✓ the ONLY check that exercises vercel.ts
│
├── modules/profile-capture/    ─────────────  THE ANDROID BUBBLE  ─────────────
│   ├── index.ts                JS bridge: configureChat · consumePendingCapture · …
│   └── …/profilecapture/
│       ├── RizzAccessibilityService.kt   watches 5 allowlisted apps, owns the bubble
│       ├── ScreenClassifier.kt           ⚠ profile-vs-chat signals + VETO lists
│       ├── OverlayController.kt          draws · drags · edge-snaps the ✨ bubble
│       ├── GeminiChatClient.kt           inline reply → POST /v1/ai/chat
│       ├── ChatEntitlement.kt            the offline entitlement snapshot
│       ├── CaptureStore.kt               screenshot hand-off into JS
│       ├── ProfileCaptureModule.kt       the Expo module surface
│       ├── RizzAnalytics.kt              bubble_shown / bubble_tapped, from Kotlin
│       └── ScreenClassifierTest.kt       ✓ JUnit — the only Kotlin runner here
│
└── docs/README.md              this file
```

Legend: **★** the one place a thing is allowed to happen · **⚠** a documented trap, read the
section before editing · **✓** has a runnable check (§10).

---

## 3. The client

### 3.1 Screens and navigation

Expo Router, four tabs behind a custom `FloatingTabBar`. Each tab is the root of its own stack,
which has one consequence worth knowing: the three AI tools render their result **in place** by
flipping a `phase` state to `'done'` rather than pushing a route. So Android hardware back would
skip straight past the report and exit the app. Every such screen calls
`useBackToIdle(phase === 'done', reset)` to fix that.

`vault` and `paywall` are full-screen modals on Android and must apply `insets.top` themselves —
iOS sheets report 0 there.

### 3.2 State

`useRizzStore.ts` — Zustand, persisted to MMKV. Anything that must survive a reload has to be
listed in `partialize` or it silently won't be.

`analysisCount` in the store is **an optimistic cache, not the truth**. The server owns the
credit balance; every API response carries the real number and overwrites the local one. This is
why reinstalling to clear MMKV no longer grants three fresh analyses.

`state/limits.ts` owns the swipe allowance. Both the store and Discover must call
`swipesUsedToday()` / `nextSwipeState()` — when they each derived it themselves, a cumulative
count permanently locked free users out of a feed that refreshes daily.

`state/session.ts` is identity. There is no login. The **server** mints an anonymous install id
on first launch, which the device keeps forever and trades for a 24h JWT. It is not generated on
device: React Native has no `crypto` global, and this id is the bearer credential that owns the
user's credits.

### 3.3 Theme and layout

`tokens.ts` owns the design language — colour, type, spacing, radii. Never hardcode a hex or a
px in a screen.

`layout.ts` owns everything that depends on the *device*: screen size, safe-area insets, OS font
scale.

- `useLayout()` → `{ width, height, fontScale, gutter, landscape, compact, tablet }`. `gutter` is
  the only horizontal padding a screen body should use — it tightens on narrow phones and grows
  past 560pt so the column stays readable and centred on a tablet.
- `useTabBarClearance()` is the bottom padding for every screen behind the floating tab bar. It
  tracks the bar's real geometry including font-scale growth.
- `cardHeightFor(...)` for hero cards, so they don't clip their own copy at large text sizes.

Rotation and tablets are enabled, so **every screen must survive a ~390pt-tall viewport.**

Accessibility rules that are enforced, not aspirational:
- **Cap chrome, never cap content.** Tab labels, chips and count bubbles get
  `maxFontSizeMultiplier` 1.0–1.3; body copy and AI output scale freely.
- **`flex: 1` on a pill needs `minWidth: 0`, and its label needs `flexShrink: 1`** plus
  `numberOfLines={1}`. RN defaults `flexShrink` to 0, so an over-long label pushes its pill
  outside the gutter and `numberOfLines` cannot ellipsize text with no bounded width.
- **Contrast is arithmetic.** `theme/contrast.selfcheck.ts` reads `tokens.ts` as text and
  asserts WCAG AA against all three surfaces. `textTertiary` shipped at 3.19:1 once; it is now
  `#868697` (4.75:1).
- **Reduce Motion is handled by Reanimated already** — every animation defaults to
  `ReduceMotion.System`. The only thing to check on a new animation is where it *stops*.

---

## 4. The AI path

### 4.1 Nothing on the device talks to Google

`services/gemini.ts` was deleted. It held `EXPO_PUBLIC_GEMINI_API_KEY`, which is inlined into
the JS bundle and readable by anyone who unzips the APK, with no server-side quota behind it —
an open-ended bill rather than a bounded one.

The key, every system prompt, every response schema, the model choice, credit enforcement and
rate limiting all live in `backend/` now. Four engines remain on the client, and they contribute
only **a request body and mock seeds**:

| Engine | Route | Notes |
|---|---|---|
| `engine.ts` | `POST /v1/ai/lab` | chat screenshot |
| `profileEngine.ts` | `POST /v1/ai/profile` | two modes, one result shape |
| `bioEngine.ts` | `POST /v1/ai/bio` | |
| `feedEngine.ts` | `GET /v1/feed` | generated once per day, globally |

All of them go through `callApi` in `services/api.ts`. **Never hand-roll a fetch.** `isLiveApi`
is true when `EXPO_PUBLIC_API_URL` is set; false means every engine serves mock seeds and the
app demos fully offline.

**One documented exception:** `GeminiChatClient.kt` makes its own HTTP call, because the bubble
runs inside the accessibility service where the JS context may not exist. It calls the RizzCoach
API, not Google — there is no Gemini key in the APK any more. Do not add a second exception.

### 4.2 Profile Scan has two modes and one result shape

`'self'` coaches your own profile; `'them'` reads someone else's and returns openers.
`swipeStopper` / `intentClarity` are generic score slots and `bioLines` holds either bio lines or
openers — `PROFILE_LABELS[mode]` renames them per mode. One schema, one engine, one renderer.
Adding a mode means extending `ScanMode`; the `Record<ScanMode, …>` maps then fail to compile
until prompt, stages, labels and mock seeds all exist.

**The `'them'` prompt's HARD RULES block is not decoration.** It analyses a real person who never
consented: no appearance or body ratings, no protected-trait inference, no fake/catfish verdicts,
no location narrowing, no character judgements. `assertSafetyRails()` refuses to boot the server
if that block goes missing.

### 4.3 The gateway

`backend/src/ai/gateway.ts` is the one place the service talks to Gemini. Three things there are
load-bearing:

**`thinkingConfig: { thinkingLevel: 'low' }` — do not remove, do not raise.**
`gemini-flash-latest` is a thinking model and thinking tokens count against `maxOutputTokens`.
Without this the model spends the budget thinking, returns `finishReason: MAX_TOKENS`, the JSON
comes back truncated, `JSON.parse` throws — and the engine silently falls back to mock data.
Symptom: *"the AI ignores my screenshot."*

**The thinking key changed under a rolling alias.** `gemini-flash-latest` now resolves to Gemini
3, which dropped the numeric `thinkingBudget` for a `thinkingLevel` enum and **400s on the old
key**, on every call. Valid levels are `low`, `minimal`, `high`; there is no `none`, and `high`
reproduces the truncation. If every engine goes canned at once, run the selfcheck before
suspecting anything else.

**Do not "buy headroom" by raising `maxOutputTokens`.** Gemini 3 sizes thinking as a *fraction*
of the cap, so a bigger cap buys more thinking, latency and cost for an identical answer (the
same transcript measured thoughts=236/out=26 at 512 and thoughts=404/out=26 at 2048). Measure
with `usageMetadata` before changing any cap.

**Prompts are versioned by content hash.** `promptVersion()` logs the first 8 hex of
sha256(prompt) on every call, so `engine + prompt + outputTokens` attributes a quality or cost
change to a specific edit. A hand-declared version is wrong the first time someone tweaks a
prompt without bumping it.

### 4.4 Grounding: the Lab quotes before it answers

`labSchema` puts a `read` object **first** in the schema and first in every mode's `required`
list — the last message verbatim, who sent it, and one line naming the running thread. Gemini
emits properties in schema order, so the model commits to what the conversation says before it
writes a single reply. The client renders it as a quote card above the replies, which doubles as
proof to the user that it actually read their screenshot. Mock seeds carry no `read`, so the
card's absence is a free tell that you are looking at canned data.

### 4.5 The silent mock fallback

Every engine catches failures and returns mock data so the app demos offline. This is
deliberate, and it is also the single most confusing behaviour in the codebase: **a live API URL
does not mean you are seeing live output.** When debugging "the AI isn't working", check the
console warn (`[engine] live analysis failed`) before anything else.

### 4.6 Adding an engine

Two-sided change. Server: a system prompt in `ai/prompts.ts`, a `responseSchema` (uppercase
OpenAPI types) in `ai/schemas.ts`, and a route in `routes/ai.ts` wrapped in `charged()` so a
failure refunds. Client: a request body and mock seeds, then `callApi<T>(path, body)`. Verify
against the live API before wiring any UI.

---

## 5. The backend

Hono, deployed as a Vercel function, against Railway MySQL via Drizzle.

### 5.1 Routes

| Route | Auth | What it does |
|---|---|---|
| `GET /healthz` | — | liveness; **touches no database** |
| `POST /v1/auth/device` | — | mint or resume an install id, return a 24h JWT |
| `GET /v1/config` | optional | remote config |
| `POST /v1/ai/lab` | JWT | chat screenshot → replies / vibe / roast |
| `POST /v1/ai/profile` | JWT | 1–3 profile screenshots → report |
| `POST /v1/ai/bio` | JWT | interests + vibe → 3 bios |
| `POST /v1/ai/chat` | JWT | transcript → one reply (called by the Android bubble) |
| `GET /v1/feed` | optional | the day's Discover lines, generated once and cached in MySQL |
| `GET /v1/user/credits` | JWT | the truth about the balance |
| `POST /v1/user/pro` | JWT | verify entitlement against RevenueCat, re-issue the token |

Middleware is registered on `app` **before** the matching `route()`. Hono dispatches in
registration order, so `auth.use('*', …)` chained onto a sub-app lands after its handlers and
silently never runs.

Rate limits: 20/IP on auth, 10/user on AI, 30/user on the rest.

### 5.2 Credits

`chargeCredit()` is one atomic conditional `UPDATE` that fails closed. A double-tap cannot spend
the same credit twice — verified with 10 concurrent requests, exactly 3 granted.

Charging is symmetric with failure:

- Gemini fails or times out → `refundCredit(sub, 'generation_failed')`
- Profile Scan decides the images aren't a profile → `refundCredit(sub, 'not_a_profile')`
- The bubble reply fails → `charged()` refunds; the service just toasts

**Rejected work must never burn a credit.** One credit is charged per *screenshot*, not per
analysis: switching Lab modes and "give me another" on the same image are free.

Pro is verified server-side by `POST /v1/user/pro`, which asks RevenueCat and re-issues the
token. Call it after a purchase **and after a restore**, or a paying subscriber gets cut off at
three analyses.

### 5.3 Identity and secrets

`GEMINI_API_KEY` is validated at boot by `env.ts`, which **exits** rather than starting
half-configured. Google issues both `AIza…` and `AQ.…` formats; both go in the `x-goog-api-key`
header, never the URL — a key in a URL lands in access logs.

### 5.4 The two deployment traps

**TLS to Railway MySQL needs a pinned CA and `checkServerIdentity` skipped.** Getting
`DATABASE_CA` wrong crashes the function at module load, so *every* route 500s. Client-side that
looks like four unrelated bugs: engines serve mock seeds, and the Android bubble toasts
"RizzCoach isn't connected yet" because `installId()` rejects, so `_layout.tsx` never configures
`ChatEntitlement`. It self-heals on the next resume once the server answers. `/healthz` hits no
database and stays green through all of it — so check with:

```bash
curl -X POST $API/v1/auth/device -H 'content-type: application/json' -d '{"platform":"android"}'
```

**The serverless entrypoint is hand-rolled, on purpose.** Both published Hono Vercel adapters
are broken on a plain function in `api/`, in opposite directions, and both fail as a bare 60s
`FUNCTION_INVOCATION_TIMEOUT` with nothing logged: `@hono/node-server/vercel` rebuilds the body
from a stream Vercel already drained, so `c.req.json()` never settles and every POST hangs (GETs
are fine — which is why `/healthz` looked healthy for hours); `hono/vercel` expects a web
`Request` and gets Node's `(req, res)`, so even `GET /` hangs. `vercel.ts` reads the body from
`req.body` when the launcher parsed it and **only** reads the stream when it has not ended —
awaiting `end` on a spent stream is the hang. `npm run dev` uses `index.ts` and a real Node
server, so no local run exercises this file. Run `vercel.selfcheck.ts` after touching it.

---

## 6. The Android analyzer (the actual moat)

The AI is not the moat — anyone can call Gemini. The moat is that the reply appears **where the
user already is**, with no app switch.

`modules/profile-capture/` is a local Expo module containing an accessibility service:

| File | Job |
|---|---|
| `RizzAccessibilityService.kt` | watches window changes in five allowlisted apps |
| `ScreenClassifier.kt` | decides "is this a profile / a chat", by view-id signals and veto lists |
| `OverlayController.kt` | draws and drags the ✨ bubble |
| `CaptureStore.kt` | hands a captured screenshot to JS on next app open |
| `GeminiChatClient.kt` | calls `POST /v1/ai/chat` for an inline reply |
| `ChatEntitlement.kt` | the entitlement snapshot the service gates on |

**Two different flows come out of that bubble:**

- **Profile capture** — the bubble grabs a screenshot and opens RizzCoach, and the scan runs
  through the normal `/v1/ai/profile` path. Charged like any Profile Scan.
- **Inline chat reply** — everything happens inside the service, in a process where React Native
  may not be running at all. It calls `/v1/ai/chat` itself and never launches the app.

Because that second path cannot reach the store, entitlement crosses the boundary as an explicit
snapshot, not a parse of Zustand's persisted JSON:

- JS pushes down `{ apiUrl, installId, isPro, freeRemaining }` on launch and every resume
  (`configureChat`).
- The service gates a tap on that snapshot instantly and offline, and overwrites it with the
  server's balance after every generation (`applyServerCredits`).
- JS calls `refreshCredits()` (`GET /v1/user/credits`) **before** deriving the snapshot it pushes
  down. Without that ordering the app pushes its own stale MMKV count over the accurate one the
  service just wrote, and bubble replies look free forever.
- It carries the **install id**, never a token: the bubble fires days after the app was last
  opened, by which point a 24h JWT is dead.

`ScreenClassifier`'s veto lists matter more than its positive signals. A wrong positive means
the bubble never shows — annoying. A wrong veto means the bubble shows over someone's private
DMs — that is the one that loses the user.

**The standing cost of this approach:** Instagram ships an update, renames its view ids, and
detection breaks. That is not a bug, it is the deal. Unit tests live in
`ScreenClassifierTest.kt`; add a case per app as you learn the real ids.

---

## 7. Monetization

RevenueCat, keyed **per platform** — Apple is `appl_`, Google Play is `goog_`.
`isLiveRevenueCatKey()` in `state/limits.ts` is the one rule. A stub key silently drops that
platform into mock mode, where `purchasePlan()` grants Pro for free after a fake 1.4s sheet.
Failure is silent and in the user's favour — check the key first when "the paywall does nothing".
`EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is intentionally a stub in `preview`; set a real one before
production.

**Paywall events are logged once, inside `paywall.tsx`.** The entry point rides in as a route
param (`/paywall?source=…`), so a new call site is attributed for free and `paywall_viewed`
cannot drift from `paywall_dismissed`. Do not instrument the `router.push` call sites.

---

## 8. Analytics and privacy

`track()` takes an event from **a fixed union**, never a name and a free-form payload. This app
transmits screenshots of other people's private conversations; `track('x', {...body})` would put
a transcript in an analytics warehouse forever, in another company's jurisdiction, with no delete
story. There is no overload that accepts arbitrary data, so the mistake has nowhere to live.
Never add a parameter carrying message text, bios, names, openers, `uiText`, the package name of
the app being viewed, or the install id. Same rule, same reason, in `backend/src/lib/logger.ts`.

`app_open`, `first_open`, `session_start`, `screen_view` and `app_exception` are collected
automatically by GA4 and are **reserved** — logging them by hand is silently dropped.
`pro_purchased` is deliberately not called `purchase`: that is a GA4 commerce event expecting
`currency`/`value`/`items`, RevenueCat already reports revenue, and a half-populated `purchase`
corrupts GA4's revenue model.

Firebase is **opt-in**, gated on `GOOGLE_SERVICES_JSON` in `app.config.ts`. Unset means no
plugins, the app builds exactly as before, and `analytics.ts` no-ops because the native module is
absent.

`bubble_shown` / `bubble_tapped` are logged from Kotlin, and they are why this app uses Firebase
at all: the bubble's lifecycle runs in a process with no JS context, and these are the two most
valuable events in the product. A native SDK is the only way they land in the same user's funnel
instead of an orphaned second identity. `RizzAnalytics.kt` resolves Firebase reflectively and
swallows every failure — a crash there would kill the user's ability to analyse anything until
they re-enabled the service in Settings.

Crashlytics only; **Sentry is deliberately absent.** Firebase is already mandatory, Crashlytics
is nearly free incrementally, and it captures native crashes in the accessibility service that a
JS-first SDK handles poorly. Two crash SDKs means two dashboards and double the native weight for
one signal.

---

## 9. Shipping

```bash
eas build -p android --profile preview                       # APK
eas build -p ios --profile simulator                         # iOS, no Apple account needed
eas update --branch preview --environment preview -m "…"     # JS-only OTA
cd backend && vercel --prod                                  # the server ships separately
```

**Deploy the backend before the OTA** when a change spans both. The reverse works but looks
broken — the app asks for a field the old server doesn't return.

**`runtimeVersion` is `appVersion`, and policing it is now your job.** It used to be
`fingerprint`, which was safer and unusable: every native or dependency change minted a fresh
runtime version and orphaned every installed build. Under `appVersion`, every build sharing
`version` in `app.json` accepts the same updates — so JS fixes actually reach installed apps.
The cost is that the safety net is gone:

> **Bump `version` in `app.json` in the SAME change as any native edit.** Native means anything
> under `modules/`, a new dependency with native code, a plugin, or an `app.json` field that
> lands in the manifest. OTA-ing JS that calls a native symbol the installed build lacks crashes
> it on launch, for everyone, with no recovery but a reinstall.

Rule of thumb: **JS/TS/assets only → update. Anything else → bump `version`, build, reinstall.**

**A channel with no branch mapped to it serves nothing.** Builds resolve updates through their
*channel*; `eas update --branch X` publishes to a *branch*. If they aren't linked, every publish
succeeds and reaches zero devices:

```bash
eas channel:view preview          # "No branches are pointed to this channel" = the bug
eas channel:edit preview --branch preview
```

**An update only reaches builds whose runtimeVersion matches.** Publishing succeeds regardless.
Build first, then update.

**Updates apply on the second launch.** Expo boots the cached bundle and downloads in the
background. Force-stop, open, close, open again.

**Build keys come from the EAS environment, not `.env`.** `.env` is gitignored so it never
reaches EAS. A profile only loads them if it declares `"environment"` — `preview` and
`production` do. Drop that field and the build succeeds with no `EXPO_PUBLIC_API_URL` baked in,
`isLiveApi` is false, and every engine silently serves mock data. `eas env:list --environment
preview` before blaming the model.

**`app.config.ts` layers over `app.json`; the iOS widget is opt-in.** The widget plugin needs an
Apple Team ID, so it attaches only when `APPLE_TEAM_ID` is set. Never hand-declare the App Group
entitlement or an `appExtensions` target next to the plugin — it generates both. Verify any
config change with `npx expo config --type public`.

Any local Android build mutates `node_modules` (Gradle writes `build/`, `.gradle/`, `.classpath`
into autolinked packages). `npm ci` before `eas build` if a build behaves oddly.

---

## 10. Checks

```bash
npx tsc --noEmit                                        # must pass
node src/state/limits.selfcheck.ts                      # swipe allowance + store keys
node src/theme/contrast.selfcheck.ts                    # palette vs WCAG AA
cd backend && npx tsc --noEmit
cd backend && node --env-file=.env --import tsx src/ai/gateway.selfcheck.ts   # 1 live Gemini call
cd backend && node --env-file=.env --import tsx src/vercel.selfcheck.ts       # serverless POST body
cd backend && node --env-file=.env --import tsx src/middleware/credits.selfcheck.ts
cd android && ./gradlew :profile-capture:testDebugUnitTest                    # classifier
```

`*.selfcheck.ts` are framework-free Node scripts (Node 24 strips types natively) and are excluded
from `tsconfig.json`. Add one next to non-trivial pure logic; don't add a test framework.

`layout.ts` deliberately has no selfcheck — it transitively imports `react-native`, which Node
cannot parse, and duplicating the spacing values into an import-free module would be worse than
the arithmetic being unguarded. Verify layout changes with `npx expo export --platform android`.

---

## 11. Testing the Android analyzer

Needs a **physical Android phone, API 30+**, with Instagram/Tinder logged in. An emulator cannot
do this: `takeScreenshot()` needs API 30+, and you cannot realistically log into Instagram on a
fresh emulator.

**1. Install** — `adb install -r <build>.apk`, allowing "install unknown apps".

**2. Verify the plumbing** (independent of the selectors):
Profile Scan → "Their profile" → "Skip the screenshot" → the analyzer screen. Confirm the
disclosure lists the five apps and says capture only happens on a tap. Tap Step 1 → Accessibility
settings → enable **RizzCoach Profile Analyzer**. *If it is not listed, stop — that is a manifest
problem, not a selector problem.* Return; Step 1 should go green on its own (it re-reads on
resume). Step 2 → overlay permission. Then flip **Watch for profiles** on.

**3. Fix the selectors** — with the service enabled, open a profile and dump the tree:

```bash
adb shell uiautomator dump /sdcard/d.xml && adb pull /sdcard/d.xml
grep -o 'resource-id="[^"]*"' d.xml | sort -u
```

Compare against `ScreenClassifier.kt`. **Do the negatives first if you are short on time** — dump
a reel, a DM thread and a story, and make sure their real ids are in the veto lists. Repeat per
app, and add a unit test per app with the real ids.

**4. Test detection** — bubble appears on a profile within ~0.5s; does not flicker while
scrolling (the signature guard); disappears on reels/DMs/stories; **never** appears in WhatsApp
or a banking app; drags and snaps to an edge without firing an analyze; tap opens the report.

**5. Test the edges** — burn all 3 credits then tap the bubble (should land on the paywall);
kill switch off means no bubble anywhere; revoking overlay permission mid-run must not crash;
rapid taps produce exactly one capture; rotation and split-screen survive; an idle hour should
leave RizzCoach near zero in Battery usage.

**6. Watch the logs** — `adb logcat -s RizzA11y:* RizzOverlay:* RizzChatApi:* ReactNativeJS:*`

| Message | Meaning |
|---|---|
| `service connected` | the service bound — good |
| `takeScreenshot failed: N` | framework throttled or refused; no retry by design |
| `overlay add failed` | overlay permission gone, or an OEM refusing the window |
| `api http 4xx/5xx` | the backend rejected it; the credit was refunded |
| `[engine] live analysis failed` | **the AI silently fell back to mock data** |

**OEM notes.** Xiaomi/MIUI, Samsung/OneUI, Huawei and OnePlus aggressively kill background
services and bury extra overlay permissions in their own settings. If it works on a Pixel and
dies on a Xiaomi, that is why.

---

## 12. Debugging table

The failure modes that have actually cost time, and what they look like from the outside:

| Symptom | Real cause | Check |
|---|---|---|
| "The AI ignores my screenshot" / canned results | any live failure — the engine fell back to mocks | console warn `[engine] live analysis failed`; then `curl` the API |
| Every engine goes canned at once | the model alias rolled and the thinking key 400s | `gateway.selfcheck.ts` |
| All four tools broken + the bubble toasts "not connected yet" | the backend is down or `DATABASE_CA` is wrong — one bug, four symptoms | `POST /v1/auth/device` (not `/healthz`, which needs no DB) |
| Every POST times out at 60s, GETs fine | the Vercel adapter drained the request body | `vercel.selfcheck.ts` |
| The OTA changed nothing | no branch mapped to the channel, or a runtimeVersion mismatch, or you only launched once | `eas channel:view <channel>` |
| The build has no AI at all | the profile didn't declare `"environment"`, so no `EXPO_PUBLIC_API_URL` | `eas env:list --environment preview` |
| The paywall does nothing | a stub RevenueCat key for that platform | `isLiveRevenueCatKey()` |
| Bubble replies never cost a credit | the app pushed a stale snapshot over the server's | `refreshCredits()` runs before `configureChat()` |
| Discover shows yesterday's items after a change | the cache tag wasn't bumped | bump `vN` in `discover.tsx` |
| Persisted state vanishes on reload | not listed in `partialize` | `useRizzStore.ts` |
