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
launch, traded for a 24h JWT. It is not generated on the device: RN has no `crypto` global, so
that would mean either `expo-crypto` (native, therefore a rebuild rather than an OTA) or
`Math.random`, and this id is the credential that owns a user's credits.

**One documented exception:** `modules/profile-capture/.../GeminiChatClient.kt`. The chat
bubble generates a reply inside the accessibility service, where the RN/JS context may not
exist, so it cannot go through `services/api.ts` and makes its own HTTP call. It now posts to
`POST /v1/ai/chat` — **there is no Gemini key and no prompt in that file any more**, and it
authenticates with the install id rather than a token, because the bubble fires days after the
app was last opened and a 24h JWT is dead by then. Do not add a second exception.

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
`engine + prompt + outputTokens` attributes a quality or cost change to a specific edit. A
declared version is wrong the first time someone tweaks a prompt without bumping it.

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

**The bubble spends credits in a process the store cannot see, so `refreshCredits()` must run
BEFORE `configureChat()`.** The accessibility service charges `/v1/ai/chat` itself and mirrors
the server's balance into its own SharedPreferences snapshot. `_layout.tsx`'s resume hook then
pushes a snapshot *down* — so if it derives that snapshot from MMKV without pulling
`GET /v1/user/credits` first, it overwrites an accurate balance with a stale one and bubble
replies look free forever. `consumeChatUsage()` is always 0 now by design; it is kept only so
a future offline queue has somewhere to refill.

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

**Login must not distinguish "no such email" from "wrong password".** One `Errors
.invalidCredentials()` for both, and the handler hashes against `DUMMY_HASH` when the row
is missing so the *timing* does not leak it either. With no reset flow, an account an
attacker guesses into is gone for good. Signup may name a username clash (usernames are
public); it must never confirm an email exists.

**`lib/password.ts` is `node:crypto` scrypt and nothing else.** N=2^15 needs 32MB, which
is exactly Node's default `maxmem` — so `MAXMEM` is set explicitly and every call passes
it. Raise N without raising `MAXMEM` and every login 500s with
`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. Parameters are stored inside the hash, so N can be
raised later without invalidating existing rows. Guarded by `password.selfcheck.ts`,
which also pins the NFKC normalisation — the same accented character composes differently
on iOS and Android keyboards, and without it a password set on one platform fails on the
other, with no reset to recover from.

**`DELETE /v1/user/me` is not a feature.** App Store Review 5.1.1(v) requires in-app
account deletion, and Play requires a deletion path. It is one statement only because the
schema holds no images, transcripts or reports; if that ever changes, this route grows
with it.

**`email` and `username` are the ONLY PII in the schema, and that is now the rule** —
`db/schema.ts` used to say "never any PII" and that line was traded deliberately in
migration 0001. Never a third column. Never log either one: `log.info('auth.signup')`
carries no fields on purpose, same rule as `logger.ts`.

**The rate limits on `/v1/auth/login` and `/signup` are load-bearing, not hygiene.**
They plus the 10-failure account lockout are the entire brute-force defence. They are
in-process counters, so they are correct on exactly one instance — **do not deploy
accounts to a serverless target without moving them to a shared store first**, or every
warm lambda hands the attacker a fresh allowance.

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

Rejected work should not burn a credit — e.g. Profile Scan checks `isProfile` and returns
before `incrementAnalysis()`.

**RevenueCat needs a key per platform — Apple is `appl_`, Google Play is `goog_`.**
`isLiveRevenueCatKey()` in `state/limits.ts` is the one rule (self-checked). A stub key
silently drops that platform into mock mode, where `purchasePlan()` grants Pro for free
after a fake 1.4s sheet. Failure is silent and in the user's favour — check the key first
when "the paywall does nothing".

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
- `bio.tsx` is the only screen with text inputs; its ScrollView carries
  `automaticallyAdjustKeyboardInsets` because the multiline field is the last thing on the
  page and iOS covered it outright. Any new input screen needs the same prop.

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
--environment preview` before blaming the model. `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is
intentionally absent, so preview builds hand out Pro free — set it before production.

**`runtimeVersion` is `appVersion` — and that is now YOUR responsibility to police.**
It was `fingerprint`, which is safer and was unusable in practice: every native or dependency
change minted a fresh runtime version and orphaned every installed build, so each OTA landed
on zero devices until a new APK was built and reinstalled. Three builds in one morning had
three fingerprints and an update matched none of them.

Under `appVersion` every build sharing `version` (`app.json`, currently `1.0.4`) accepts the
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
npx tsc --noEmit                                        # must pass
node src/state/limits.selfcheck.ts                      # swipe-allowance + store-key rules
node src/theme/contrast.selfcheck.ts                    # palette vs WCAG AA (reads tokens.ts as text)
cd backend && node --import tsx src/lib/password.selfcheck.ts                  # scrypt round-trip, no env needed
cd backend && node --env-file=.env --import tsx src/ai/gateway.selfcheck.ts   # live API (1 tiny call)
cd backend && node --env-file=.env --import tsx src/vercel.selfcheck.ts       # serverless POST body
cd backend && npx tsc --noEmit                          # server must pass too
```

`*.selfcheck.ts` are framework-free Node scripts (Node 24 strips types natively) and are
excluded from `tsconfig.json`. Add one next to non-trivial pure logic; don't add a test
framework.

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
