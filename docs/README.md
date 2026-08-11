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
│   │   │   ├── profile.tsx         ▸ PROFILE SCAN — self & them modes, tabbed report, DB scan history & themed delete modal
│   │   │   ├── bio.tsx             ▸ BIO OPTIMIZER — text inputs; needs useKeyboardInset
│   │   │   └── discover.tsx        ▸ DISCOVER — daily feed, swipe limit, lock overlay
│   │   ├── paywall.tsx           plans + purchase + restore; ALL paywall analytics live here
│   │   ├── vault.tsx             saved lines (DB synced & themed delete confirmation modal)
│   │   ├── account.tsx           signup · login · sign-out · delete account; the auth gate
│   │   ├── analyzer.tsx          disclosure + the two-permission flow for the bubble
│   │   ├── ai-consent.tsx        ★ upload consent — blocks all 3 AI tools until granted
│   │   ├── onboarding.tsx        the 3 setup questions — every answer feeds coachParts()
│   │   ├── welcome.tsx           ★ 4 scripted demos, BEFORE the signup gate
│   │   └── +not-found.tsx
│   │
│   ├── components/             25 shared UI pieces
│   │   ├── HapticPressable.tsx   the base touchable — everything routes through it
│   │   ├── ConfirmDialog.tsx     ★ the ONE destructive-confirm dialog — never Alert.alert
│   │   ├── ScanReport.tsx        the Profile Scan report — split out of profile.tsx
│   │   ├── AuthFields.tsx        CredentialFields · CodeStep · Field — split out of account.tsx
│   │   ├── AppErrorBoundary.tsx  ★ the crash screen — exported as `ErrorBoundary` by NAME
│   │   ├── ScreenHeader.tsx      wordmark + credit meter + vault, on all three AI tools
│   │   ├── AiNotice.tsx          ★ the "sent to Google Gemini" line — all three AI tools
│   │   ├── SplashIntro.tsx       ★ animated splash — must match app.json's native one exactly
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
│   │   ├── contracts.ts          ✓ response guards, called by callApi before rendering
│   │   ├── engine.ts             Lab       →  POST /v1/ai/lab
│   │   ├── profileEngine.ts      Profile   →  POST /v1/ai/profile
│   │   ├── bioEngine.ts          Bio       →  POST /v1/ai/bio
│   │   ├── feedEngine.ts         Discover  →  POST /v1/ai/feed
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
│   ├── data/                   mockAnalysis.ts · feed.ts · assets.ts · interests.ts
│   ├── utils/                  hooks + helpers
│   │   ├── useCreditGate.ts      ★ the ONE free-tier block → paywall, with attribution
│   │   ├── useAiConsent.ts      ★ the ONE upload-consent block → /ai-consent (NOT a paywall)
│   │   ├── useStagedProgress.ts  the "thinking" stage ticker (owns the timer, nothing else)
│   │   ├── contentId.ts        ★ stable id from text — savable things, never uid()
│   │   └── useBackToIdle.ts · useKeyboardInset.ts · haptics.ts · misc.ts
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
│       ├── routes/               auth.ts · ai.ts · user.ts · webhooks.ts · legal.ts
│       │   └── auth.selfcheck.ts     ✓ install claim + the four account-existence codes
│       ├── middleware/           auth.ts · credits.ts · rateLimit.ts · idempotency.ts
│       │   └── credits.selfcheck.ts    ✓ runnable
│       ├── db/                   schema.ts · client.ts · railway-ca.ts · migrate.ts · migrations/ (0000–0009)
│       ├── lib/                  logger (rid) · errors · jwt · limits · revenuecat · otp · mailer
│       │   └── otp.selfcheck.ts      ✓ single-use · attempt cap · expiry · daily send cap
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
├── eslint.config.js            expo flat config + 4 documented deviations — 0 errors required
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

**First run is four steps, in this order, and `_layout.tsx` queues them:**

| Step | Route | Flag that ends it | Skippable |
|---|---|---|---|
| 0 | `welcome.tsx` | `hasSeenWelcome` | no — `account` is not even declared |

`welcome.tsx` is itself four horizontal pages, all four scripted demos: **Bio Lab** (chips
picked, a vibe chosen, a bio written), **the Lab** (a screenshot picked, read, three replies
back), **Profile Scan** (the ✨ bubble on a profile) and **chat** (the ✨ bubble in a
conversation). The order is a widening claim — two things you do inside the app, then two it
does inside theirs. A `ScrollView pagingEnabled` carries them so swipe works for free; the CTA
and dots live outside it, or the button would slide off screen mid-swipe. Every loop runs
through `usePhaseLoop` and is gated on `live`, otherwise each burns a timer and a re-render
every few hundred ms behind the other pages from the app's first frame.

With no stills left, none of the four is the payoff by contrast, so the **kind of reveal**
carries that instead and each kind means something: pages 0–1 swap their content in place
(one screen changing its own state, which is what those tabs do), Profile Scan's sheet covers
the whole card (`launchApp()` — RizzCoach came to the foreground), and the chat sheet covers
only the composer (our surface over someone else's app). The ✨ appears only on pages 2–3, so
the gesture keeps meaning one specific thing.

Bio Lab and the Lab each carry more than one worked example — three chip combinations and two
screenshots respectively — indexed by the `cycle` count `usePhaseLoop` returns. A loop that
replays identically is the moment someone decides they have seen it. Every bio traces back to
its own three chips and every reply answers the last line of its own thread; that traceability
*is* the claim, since a bio you cannot trace back to what you tapped is a template.

The Vault lost its page to the Lab: a screen in front of the signup gate has to earn itself
against the tab a new user actually lands on, and the Vault is where you go once you already
have lines worth keeping. It survives as a fact chip, "Save what lands".

Every stage list and label on these pages is **imported, not retyped** — `ANALYZE_STAGES`,
`PROFILE_STAGES.them`, `PROFILE_LABELS.them`, and `INTERESTS` (moved to `data/interests.ts` so
both Bio Lab and welcome can read it without welcome pulling `BioScreen` onto the cold-start
path). A retyped copy drifts the first time something is renamed, and then onboarding is
advertising a screen the app does not have.
| 1 | `account.tsx` | `account != null` | no — `(tabs)` is not even declared |
| 2 | `onboarding.tsx` | `coach != null` | no |
| 3 | `analyzer.tsx` | `hasOnboarded` | yes, set on dismissal either way |

Each waits on the previous one's flag. Steps 2 and 3 are pushes fired on the same mount, so a
step that does not wait lands on top of whichever modal won the race. Step 3 is Android-only
(`isSupported`), which is why the landing effect treats iOS as done after step 2.

**Step 2 waits on a network call, not a timer.** A returning user's answers live only on their
server row; `adoptCoach()` in `useRizzStore` takes them, but they ride on `/v1/user/credits`,
and nothing forced that call after a login — the refresh effect runs on mount and on resume,
and on a fresh install the mount happens while there is still no account to authenticate with.
So the answers arrived on the next resume at the earliest, long after the push. **Someone who
answered these three questions months ago on another device reinstalled and was asked all three
again.** The effect now awaits `refreshCredits(true)` and re-reads `coach` from the store in the
callback — `adoptCoach` writes it from that very response, so `coachStepDone` in the closure is
a snapshot from before it. Offline resolves too, with `coach` still null, and then we ask: three
questions is a smaller harm than an unpersonalised account, and the answers upsert either way.

Steps 0 and 1 are not pushes at all — they are **declaration guards**, and that is the whole
technique. A `Stack.Protected` screen is not hidden, it is undeclared, so while step 0 is up
`/welcome` is the only route in the navigator and there is no other screen for the user to see
a frame of. Its CTA sets `hasSeenWelcome`, which un-declares `/welcome` and declares `/account`
in one commit; the navigator lands on the next gate with no navigation call and therefore no
transition to mis-time. `/welcome` is guarded on `!welcomeStepDone` rather than declared
permanently first, because a permanently-first route goes on being the fallback — a user who
watched the demo but has no account would land back on it instead of on signup.

`welcomeStepDone` is `hasSeenWelcome || accountStepDone`. The second half is what keeps an
existing install out of the demo on upgrade, and covers the no-API build where there is no
signup gate to soften.

Step 0 exists to answer the cost the account gate's own comment states: it lands before the
user has seen a single result, so every install unwilling to hand over an email dies there.
The four demos replay the product end to end — a bio built out of three tapped chips, a
screenshot turned into three replies, a profile scored from the bubble, and a chat answered
from it — so the email is traded for something watched rather than promised.

The demos are **scripted animations, not video files**: a recording would add tens of MB to the
install, need a re-export for every copy change (and so drift stale the first time nobody
bothered), resist translation, and letterbox on any aspect ratio it was not exported for. The
art is the bundled `BG` gradients and the `AVATARS` portrait already in `data/assets.ts` — no
new art was shot for this screen.

⚠️ **Every number and line on all four pages is hardcoded, and must stay hardcoded.** This
screen runs before the account exists, before `aiConsent`, and before any credit could be
charged; wiring any of it to a live engine would bill a user who has agreed to nothing. The
mock *shapes* are real, though, and that is the maintenance burden: Profile Scan scores out of
10 with a note per score (`ProfileScore`), Bio Lab returns labelled tone variants (`BioOption`),
the Vault stores lines by category. If one of those shapes changes, the mock changes with it or
it becomes a lie told on the first screen of the app.

**Only routes belong in `src/app/`.** The folder *is* the router, so a helper component left
beside a screen becomes a reachable URL. That is why the two big screens were split into
[components/](../src/components/) rather than into a folder next to themselves. Each screen
keeps its shell — the copy and controls that read three or four flags at once — and hands off
only the parts that read nothing but props.

### 3.2 State

`useRizzStore.ts` — Zustand, persisted to MMKV. Anything that must survive a reload has to be
listed in `partialize` or it silently won't be.

`analysisCount` in the store is **an optimistic cache, not the truth**. The server owns the
credit balance; every API response carries the real number and overwrites the local one. This is
why reinstalling to clear MMKV no longer grants three fresh analyses.

⚠️ **Exactly one writer against a live API: `reportCredits`.** `incrementAnalysis()` is guarded
with `isLiveApi ? state : count + 1`. Both used to fire — the server envelope already carries the
post-charge count, and the screen then added its own +1 — so a free user was locked out after
**two** of three free analyses. It hid because the local increment is correct offline, which is
the mode everyone develops in. Full trace in `AGENTS.md`.

**The vault and scan history now outlive the install.** Saved lines live in `saved_items` and
profile-scan summaries in `profile_scans` (migrations 0009 and 0008). `state/session.ts` owns
both sides: `fetchVault()` and `fetchScans()` hydrate on screen mount ([vault.tsx](../src/app/vault.tsx),
[profile.tsx](../src/app/(tabs)/profile.tsx)), and the store actions mirror every write —
`toggleSave` → `saveVaultItem`, `removeSaved` → `deleteVaultItem`, `clearVault` →
`clearVaultItems`, `forgetScan` → `deleteScan`.

Three properties are load-bearing:

- **The client mints the id and the server stores it verbatim** as the primary key, so the local
  row and the server row are the same row. `POST /v1/user/vault` is an upsert
  (`ON DUPLICATE KEY UPDATE`) for exactly this reason — re-save is idempotent. Never regenerate
  an id on sync; you get a duplicate the user has to delete twice.
- **MMKV stays the optimistic copy, the DB is the durable one.** Every sync helper returns
  `false`/`[]` rather than throwing, and returns early when `isLiveApi` is false, so the vault
  works fully offline — at the cost of a local write that never reached the server going quiet
  until the next fetch overwrites it.
- **These helpers hand-roll `fetch` on purpose,** like everything else in `session.ts`: they carry
  the raw `Authorization` header and must not depend on `callApi`, which sits *on top* of session
  identity. That is the boundary — §4.1's "never hand-roll a fetch" governs the engines, not this
  file.

Scan history is capped at 20 by the `GET /v1/user/scans` query; the vault has no cap at all,
which is why [vault.tsx](../src/app/vault.tsx) is the one list with explicit virtualization
bounds. See §5.4a for what those two tables are allowed to hold — the rule is narrower than it
looks.

`state/limits.ts` owns the swipe allowance. Both the store and Discover must call
`swipesUsedToday()` / `nextSwipeState()` — when they each derived it themselves, a cumulative
count permanently locked free users out of a feed that refreshes daily.

`state/session.ts` is identity. There is no login. The **server** mints an anonymous install id
on first launch, which the device keeps forever and trades for a 30-day JWT. Long tokens are safe because
`requireAuth` re-reads the row every request and compares `token_epoch` — that check IS the
revocation mechanism. The id is not generated on device: React Native has no `crypto` global,
and it is the bearer credential that owns the user's credits.

Accounts layer on top: `/v1/auth/signup` **claims** the install's row rather than inserting a new
one, email is verified by a mailed six-digit code, and `/v1/auth/login` takes a password OR a
code — the code path being the closest thing this product has to a password reset.

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
  `AnalyzingOverlay` is the one place needing `useReducedMotion()` explicitly: its beam froze
  parked at the card's bottom edge and read as a rendering bug.
- **Destructive actions confirm through `<ConfirmDialog>`, never `Alert.alert`.** Removing a
  saved line, clearing the vault, forgetting a scan and deleting the account all delete a
  *server* row, so the dialog is the only thing between a mis-tap and data that is gone. The
  native alert renders in the OS palette — white sheet, blue text, ALL-CAPS Android buttons —
  in the middle of a dark app, and cannot read `tokens.ts` at all. Five hand-rolled copies
  across three screens collapsed into
  [components/ConfirmDialog.tsx](../src/components/ConfirmDialog.tsx); pass `busy` for an async
  confirm and it disables both buttons, spins the danger one, and stops the scrim and Android
  back from dismissing a request that is already in flight. Add a prop rather than a sixth copy.
- **Keyboard handling needs both halves.** `automaticallyAdjustKeyboardInsets` is iOS-only, and
  under the edge-to-edge display SDK 54+/RN 0.86 enforce the Android window no longer resizes on
  keyboard open — so `adjustResize` stopped working and Android had none. `useKeyboardInset()` is
  the Android half. `bio.tsx` and `account.tsx` both need it.

---

## 4. The AI path

### 4.1 Nothing on the device talks to Google

`services/gemini.ts` was deleted. It held `EXPO_PUBLIC_GEMINI_API_KEY`, which is inlined into
the JS bundle and readable by anyone who unzips the APK, with no server-side quota behind it —
an open-ended bill rather than a bounded one.

The key, every system prompt, every response schema, the model choice, credit enforcement and
rate limiting all live in `backend/` now. Four engines remain on the client, and they contribute
only **a request body and demo-mode seeds**:

| Engine | Route | Notes |
|---|---|---|
| `engine.ts` | `POST /v1/ai/lab` | chat screenshot |
| `profileEngine.ts` | `POST /v1/ai/profile` | two modes, one result shape |
| `bioEngine.ts` | `POST /v1/ai/bio` | |
| `feedEngine.ts` | `POST /v1/ai/feed` | generated once per day, globally |

All of them go through `callApi` in `services/api.ts`. **Never hand-roll a fetch.** `isLiveApi`
is true when `EXPO_PUBLIC_API_URL` is set; false means every engine serves mock seeds and the
app demos fully offline. When it IS set, the seeds are unreachable — see §4.5.

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
comes back truncated and `JSON.parse` throws — so every analysis fails and every user sees a
toast. Symptom: *"it errors on every screenshot."*

**The thinking key changed under a rolling alias, which is why the model is now pinned.**
`gemini-flash-latest` resolved to Gemini 3, which dropped the numeric `thinkingBudget` for a
`thinkingLevel` enum and **400s on the old key**, on every call. Valid levels are `low`,
`minimal`, `high`; there is no `none`, and `high` reproduces the truncation. `MODEL` is an
explicit version now — if every engine fails at once, run `npm run check` (it makes a real call)
before suspecting anything else.

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
card's absence is a free tell that you are in demo mode.

### 4.5 Mock seeds are a demo mode, not a fallback

**A live failure throws. It does not quietly become a canned answer.** Every engine reads
`if (!isLiveApi) return simulate…()` on the first line and then returns `callApi(…)` — so the
seeds are reachable only when `EXPO_PUBLIC_API_URL` is unset. With a URL set, an outage, a
`SCHEMA` mismatch or a 500 propagates to the screen, which catches it, toasts, and leaves the
user where they were. `index.tsx`, `profile.tsx` and `bio.tsx` each carry that catch.

This section used to say the opposite, and said it for long enough to be quoted into an audit:
*"every engine catches failures and returns mock data."* That was true once. It was deliberately
removed because an outage was indistinguishable from a bad answer — the user was charged a
credit and handed a fabricated analysis of a screenshot nothing had read. **Do not restore it.**
A visible error is the correct output for a failure.

**`feedEngine` is the one exception, and it is not the same thing.** It catches, warns
`[feed] live fetch failed`, and returns `[]`, at which point Discover falls back to the
**curated** feed in `data/feed.ts` — human-written lines that were always going to be shown to
somebody. That is content degrading to other content, not an analysis being invented. The feed
is also the only engine whose result is not about anything the user supplied.

So when debugging "the AI isn't working": you will have an error and a toast. Check the console
for `[engine] live analysis failed`, then `curl` the API.

### 4.5a The response is validated before anything renders

[services/contracts.ts](../src/services/contracts.ts) is called inside `callApi`. It exists
because [types.ts](../src/types.ts) and [schemas.ts](../backend/src/ai/schemas.ts) describe the
same four payloads in two languages with nothing enforcing it, and `callApi<T>` only *cast* the
answer. The server ships separately from an OTA and an installed build cannot be rolled back —
so a renamed field arrived as `undefined` and painted blank cards, silently.

A mismatch now throws `ApiError('SCHEMA')`, which reaches the screen's catch: the user gets a
toast and stays put instead of watching blank cards paint, and Crashlytics gets the trace.
The guards check **only what a renderer dereferences unconditionally** — stricter than the UI
would turn a cosmetic server change into a user-facing outage. `isProfile: false` passes
carrying none of the report (a rejection is a valid answer), and an unknown route passes so a
fifth engine is never blocked by a guard nobody has written. Checked by
`contracts.selfcheck.ts` in `npm run checks`.

### 4.5b The onboarding answers are prompt input, not a stored quiz

The three first-run questions (`onboarding.tsx`) become `coachParts()` in `ai/prompts.ts`, which
the Lab, Profile Scan and Bio Lab routes append to the **user turn**. Rules:

- **A new question means a new branch in `coachParts` in the same change.** An answer that is
  only stored is friction in front of the paywall that buys nothing, and nothing fails when it
  happens — the app works, the output is just generic. `ai/prompts.selfcheck.ts` is what notices.
- **Closed enums only, both sides.** `COACH_APPS` / `COACH_STRUGGLES` / `COACH_STYLES` are zod
  enums on the server and a union in `src/types.ts`. That is what makes it safe to feed the
  model at all: with no free-text field there is nothing a user can type that becomes an
  instruction. Rename a value on one side only and the server silently drops it.
- **User turn, never the system instruction.** Besides the `ui_text` rule, `promptVersion()`
  hashes and memoises the system string — a per-user system prompt would mint a prompt "version"
  per combination and destroy the cost/quality attribution the hash exists for.
- The native chat bubble does **not** send it yet: `GeminiChatClient.kt` posts `transcript` and
  `tone` only, and adding a field there is a rebuild, not an OTA.

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
| `POST /v1/auth/device` | — | mint or resume an install id, return a 30-day JWT |
| `POST /v1/auth/otp` | — | mail a 6-digit code. 409 `EMAIL_TAKEN` / 404 `NO_ACCOUNT` |
| `POST /v1/auth/signup` | JWT | claim this install's row; requires a verified code |
| `POST /v1/auth/login` | — | password **or** code (XOR). `WRONG_PASSWORD` / `ACCOUNT_LOCKED` |
| `POST /v1/auth/logout` | JWT | bump `token_epoch` — kills every token on every device |
| `POST /v1/ai/lab` | JWT | chat screenshot → replies / vibe / roast |
| `POST /v1/ai/profile` | JWT | 1–3 profile screenshots → report |
| `POST /v1/ai/bio` | JWT | interests + vibe → 3 bios |
| `POST /v1/ai/chat` | JWT | transcript → one reply (called by the Android bubble) |
| `POST /v1/ai/feed` | JWT | the day’s Discover lines, generated once and cached in MySQL |
| `GET /v1/user/credits` | JWT | the truth about the balance |
| `GET /v1/user/vault` | JWT | saved lines, newest first, capped at 500 + `has_more` |
| `POST /v1/user/vault` | JWT | upsert one saved line — client-minted id is the PK |
| `DELETE /v1/user/vault/:id` · `DELETE /v1/user/vault` | JWT | remove one · clear all |
| `GET /v1/user/scans` | JWT | the last **20** profile-scan summaries |
| `DELETE /v1/user/scans/:id` | JWT | forget one scan |
| `POST /v1/user/pro` | JWT | verify entitlement against RevenueCat, re-issue the token |
| `DELETE /v1/user/me` | JWT + account | one transaction, six deletes — see §5.5 |
| `POST /v1/webhooks/revenuecat` | HMAC | renewals and cancellations; RevenueCat has no JWT |
| `GET /terms` · `/privacy` | — | registered above every `use()` so a reviewer can reach them |

Middleware is registered on `app` **before** the matching `route()`. Hono dispatches in
registration order, so `auth.use('*', …)` chained onto a sub-app lands after its handlers and
silently never runs.

Rate limits: `/v1/auth/*` uses **`dbRateLimit`** (a shared MySQL token bucket) so it survives
horizontal scaling — an in-process Map hands every warm lambda a fresh allowance. Tightest
first: `/otp` 4 @ 0.02/s · `/signup` 5 @ 0.01/s · `/login` 8 @ 0.05/s · `/v1/auth/*` 20 @ 0.2/s.
`/v1/ai/*` (10/user) and `/v1/user/*` (30/user) stay in-process on purpose — the real gate there
is the database-backed credit cap.

Every request carries a correlation id (`rid`) on every log line, via `AsyncLocalStorage` in
`lib/logger.ts`. Taken from an inbound `x-request-id` when present, and echoed on the response.

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

### 5.4 Accounts, codes, and what the server admits

Signup and login are fronted by a mailed six-digit code (`email_otps`, migration 0005). Three
properties make six digits safe, and **all three are load-bearing**: a code is single-use
(the DELETE's own predicate is the check, so there is no read-then-write window), it dies
after 5 wrong guesses, and it expires in ten minutes. Requesting a new code *replaces* the
old one, so resending buys no extra guesses either. Lengthening the code would buy less than
any of them.

**The endpoints now say whether an account exists, and that reversal was deliberate.**
`/v1/auth/otp` used to answer `{ok:true}` for a signup into a taken address *without sending
anything* — so the commonest signup mistake produced "check your email" and a code that
never existed. Four codes replaced it: `EMAIL_TAKEN`, `NO_ACCOUNT`, `WRONG_PASSWORD`,
`ACCOUNT_LOCKED`. `account.tsx` branches on the code and moves the user to the correct tab
with what they typed intact; the error string alone would barely be an improvement.
Enumeration is bounded by the IP bucket (~1 probe/50s per address), the lockout, and the fact
that knowing an address is real makes neither the password nor the mailbox easier to guess.

**Two limiters bound OTP email, and both are needed.** `RESEND_COOLDOWN_MS` (60s) sets the
minimum gap to one address; `MAX_SENDS_PER_WINDOW` (10/24h, migration 0007) caps the total.
The cooldown alone never capped anything — rotate IPs, pace to 60 seconds, and you deliver
1,440 emails a day to one victim's inbox on our bill. Both refusals are silent.

⚠️ `email_otps` rows are swept on `created_at`, **not** `expires_at` — the row carries the
send counter, and dropping it ten minutes after issue reset the daily cap every ten minutes.
The *code* still dies on the dot; `verifyOtp` has `expires_at > now` in its predicate.

### 5.4a What the schema is now allowed to hold

`db/schema.ts` opens with *"NEVER add: images, transcripts, replies, reports, or saved items"*.
Migrations 0008 and 0009 add `profile_scans` and `saved_items` — reports and saved items. **The
rule was narrowed deliberately; it was not forgotten,** and the narrowing is what keeps the
privacy policy true:

- **Nothing the user gave us is stored.** No screenshot, no image bytes, no chat transcript, no
  bio input, ever — that half of the rule is absolute and is what `analyzer.tsx` and
  `account.tsx` promise in those words. `profile_scans.summary_json` is the structured report,
  and `saved_items.text` is a line the user explicitly tapped a bookmark on.
- **Only output, and only on an explicit act.** A scan report is written because the user ran a
  scan; a vault line is written because the user saved it. Nothing lands in either table as a
  side effect.
- **Deletion is real, not a retention promise.** Both tables are purged inside the
  `DELETE /v1/user/me` transaction, and both have per-row delete routes the UI actually calls.

The one thing that genuinely changed for the user: a `'them'` report about a real third party now
persists on our servers until deleted, where it used to live only in MMKV. Keep the privacy
policy's "generated openers" wording in step with that before shipping — see §8. Adding a *third*
kind of table still needs this section rewritten first.

### 5.4b There is no remote config, and no kill switch route

`/v1/config` was **deleted**. It returned `ai_enabled`, `min_supported_version` and `flags`; no
client ever polled it, `min_supported_version` was a hardcoded string with zero readers and
`flags` was permanently `{}`. An endpoint whose every field is fiction is worse than no endpoint.

`AI_ENABLED` went with it. Stopping Gemini spend is now a **code change and a deploy** — there
is no env var to flip. If that turns out to matter at 3am, the cheapest honest version is one
guard back in `ai/gateway.ts`, not a config route nobody reads.

**There is no force-upgrade and no remote flag system.** Do not assume either exists.

### 5.5 Account deletion

**This section used to describe a store-blocking gap. Both halves have shipped.**

`DELETE /v1/user/me` is one transaction and six statements — `credit_events`, `idempotency`
(`<user_id>:%`), user-scoped `rate_limits` buckets, `profile_scans`, `saved_items`, then the
`users` row. There are still no foreign keys, so **every new user-scoped table must be added to
that transaction by hand**; nothing fails if you forget, the rows simply outlive the account. It
is fronted by `requireAccount`, not plain JWT: a device token proves someone holds the install
id, not that they are the account holder. Hard DELETE, never a soft flag — the unique key on
`email` would block the user signing up again.

The in-app button is back in `account.tsx` (`SignedIn → onDelete`), behind the themed confirm
dialog, with the control disabled while the request is in flight. App Store Review 5.1.1(v) and
GDPR Art. 17 are satisfied.

Client-side, `deleteAccount()` drops the token, the install id, the cached user, the signed-out
flag and the remembered email — the install id goes because the row it pointed at is gone and
keeping it 401s every request until a reinstall.

`deleteAccount()` clears **both** `scanHistory` and `savedItems`. It cleared only the first
once, so the vault's MMKV copy outlived the account and the next anonymous install on that
device read the deleted user's saved lines. It uses `setState` rather than the store actions on
purpose: `clearVault()` mirrors to the API, and the token is already gone by that point.

Migration 0011 adds `ON DELETE CASCADE` foreign keys to `profile_scans`, `saved_items` and
`credit_events`. Until it is applied on every environment the hand-written transaction is still
the thing that works, so **keep adding each new user-scoped table to it by hand** — the FKs are
a second belt, not a replacement.

### 5.6 The two deployment traps

**TLS to Railway MySQL needs a pinned CA and `checkServerIdentity` skipped.** Getting
the CA bundled in `backend/src/db/railway-ca.ts` (a certificate is not a credential, so it lives
in git; `DATABASE_CA` is only an optional override now). Anything that throws at module load
takes down *every* route, not just the DB ones. Client-side that
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
  opened, by which point even a 30-day JWT may be dead — and `/v1/auth/logout` revokes every
  token an account holds by bumping `token_epoch`.

### 6.1 The bubble outlives the app, and how

The service runs **in the app's process**, so swiping RizzCoach out of recents kills it and the
bubble's window dies with the process. Two things bring it back, and both are load-bearing:

1. **`ENABLED` is persisted** (`setEnabledPersisted` → prefs, restored in `onServiceConnected`).
   The in-memory flag dies with the process, and the system rebinds the service with no JS
   running to switch it back on.
2. **`scheduleReclassify()` re-asks about the current window, with retries.** No accessibility
   event fires for a window that was already open, so a user sitting still on a profile would
   otherwise see nothing until they scrolled. This retries every 400ms up to ~5s and stops on
   the first **readable** window — not the first *positive* one, so the launcher answering "not
   a profile" ends it. It was one fixed 400ms attempt, and `rootInActiveWindow` is null for a
   variable stretch after a bind: whether the bubble returned was a coin flip on timing, which
   is what "sometimes it shows, sometimes it doesn't" was.

**What this cannot fix:** MIUI, ColorOS and FuntouchOS kill the service on swipe-away and never
rebind it. Nothing in the app can recover from that — the user has to re-enable it in Settings
or exempt the app from battery optimisation. `diagnose()` exists to tell that case apart from
"the user turned it off", because they need different copy. A foreground service would hold the
process open, but it costs a permanent notification, `FOREGROUND_SERVICE_SPECIAL_USE` on API
34+, and a second thing to justify at Play review next to `canTakeScreenshot` — deliberately
not taken.

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

The analytics rule is unchanged. **The privacy policy's storage claim was reworded** to match
§5.4a: never what the user gives us, only results they asked us to keep, nothing as a side
effect, plus the few-minute idempotency cache stated outright. "Screenshots and conversations
are never saved" stays — it is still literally true. Adding a table means moving policy sections
1, 2, 6 and 7 together. The pages carry no "last updated" date by request, so nothing in the
copy may refer to one.

`app_open`, `first_open`, `session_start`, `screen_view` and `app_exception` are collected
automatically by GA4 and are **reserved** — logging them by hand is silently dropped.
`pro_purchased` is deliberately not called `purchase`: that is a GA4 commerce event expecting
`currency`/`value`/`items`, RevenueCat already reports revenue, and a half-populated `purchase`
corrupts GA4's revenue model.

Firebase is **opt-in**, gated on `GOOGLE_SERVICES_JSON` in `app.config.ts`. Unset means no
plugins, the app builds exactly as before, and `analytics.ts` no-ops because the native module is
absent.

`report_feedback` (👍/👎 on a scan report) is the only quality signal the product collects. It
carries the engine and the verdict only — never the report, its id, or its mode. The store also
keeps the rating locally, which is what re-lights the icon on a report reopened from history.

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
`isLiveApi` is false, and every engine serves mock seeds — a build that demos perfectly and
talks to nothing. `eas env:list --environment preview` before blaming the model.

**`app.config.ts` layers over `app.json`; the iOS widget is opt-in.** The widget plugin needs an
Apple Team ID, so it attaches only when `APPLE_TEAM_ID` is set. Never hand-declare the App Group
entitlement or an `appExtensions` target next to the plugin — it generates both. Verify any
config change with `npx expo config --type public`.

Any local Android build mutates `node_modules` (Gradle writes `build/`, `.gradle/`, `.classpath`
into autolinked packages). `npm ci` before `eas build` if a build behaves oddly.

---

## 10. Checks

```bash
npm run checks                                          # tsc + eslint + limits — the gate
npx eslint src modules                                  # must be 0 errors
node src/state/limits.selfcheck.ts                      # swipe allowance + store keys
node src/services/contracts.selfcheck.ts                # API response guards
node src/theme/contrast.selfcheck.ts                    # palette vs WCAG AA
cd backend && npm run check                             # tsc + 7 pure selfchecks
cd backend && npm run check:db                          # 4 selfchecks against a real DB
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
| `[engine] live analysis failed` | the call failed and the screen toasted — the user got an error, not a fake result |

**OEM notes.** Xiaomi/MIUI, Samsung/OneUI, Huawei and OnePlus aggressively kill background
services and bury extra overlay permissions in their own settings. If it works on a Pixel and
dies on a Xiaomi, that is why.

---

## 12. Debugging table

The failure modes that have actually cost time, and what they look like from the outside:

| Symptom | Real cause | Check |
|---|---|---|
| "The AI ignores my screenshot" | a real analysis of the wrong thing — check the `read` quote card, which shows what it actually saw | if the card is absent you are in demo mode (`EXPO_PUBLIC_API_URL` unset) |
| Every analysis errors and toasts | any live failure — outage, `SCHEMA` mismatch, thinking-key 400 | console warn `[engine] live analysis failed`; then `curl` the API |
| Every engine fails at once | the thinking key 400s, or `MODEL` names a version that was retired | `npm run check` in `backend/` — it makes a real call |
| All four tools broken + the bubble toasts "not connected yet" | the backend is down, or something threw at module load — one bug, four symptoms | `POST /v1/auth/device` (not `/healthz`, which needs no DB) |
| Every POST times out at 60s, GETs fine | the Vercel adapter drained the request body | `vercel.selfcheck.ts` |
| The OTA changed nothing | no branch mapped to the channel, or a runtimeVersion mismatch, or you only launched once | `eas channel:view <channel>` |
| The build has no AI at all | the profile didn't declare `"environment"`, so no `EXPO_PUBLIC_API_URL` | `eas env:list --environment preview` |
| The paywall does nothing | a stub RevenueCat key for that platform | `isLiveRevenueCatKey()` |
| Bubble replies never cost a credit | the app pushed a stale snapshot over the server's | `refreshCredits()` runs before `configureChat()` |
| Discover shows yesterday's items after a change | the cache tag wasn't bumped | bump `vN` in `discover.tsx` |
| Persisted state vanishes on reload | not listed in `partialize` | `useRizzStore.ts` |
| Locked out after 2 of 3 free analyses | `analysisCount` double-counted — `reportCredits` **and** a local `incrementAnalysis()` | the `isLiveApi` guard in `useRizzStore.ts` |
| White screen, no way back | a render throw with no boundary | `ErrorBoundary` exported by that exact name from both layouts |
| Signup says "check your email", no mail arrives | the address already has an account | `/v1/auth/otp` must return 409 `EMAIL_TAKEN`, not `{ok:true}` |
| Discover swipes vanish faster than swiping | `seen` keyed by index and reset on filter change | it is a `Set<string>` of ids in `discover.tsx`; never clear it |
| The same saved line appears twice | a savable id came from `uid()` instead of `contentId()` — the upsert inserted rather than updated | `npm run checks`; then grep for `uid()` on anything reaching `toggleSave` |
| A delete comes back on next open | the sync WRITE failed silently — the write helpers swallow errors and return `false` | is `isLiveApi` true? then `GET /v1/user/vault` by hand |
| The vault or scan list empties itself | a hydrate overwrote local state with a failed fetch — `fetchVault`/`fetchScans` must return `null`, not `[]`, on failure (§4.5) | check for a reintroduced `.length > 0` guard |
| A saved line reappears after deleting it twice | a regenerated id — the client id IS the server PK | `toggleSave` in `useRizzStore.ts` |
| A fresh install shows a deleted account's vault | `deleteAccount()` resets `scanHistory` only | `session.ts:384` |
| Credits never refresh on iOS | `refreshCredits()` folded back behind the bubble's `isSupported` guard | it needs its own effect in `_layout.tsx` |
