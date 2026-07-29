# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# RizzCoach

Expo Router app. Screens in `src/app/(tabs)/`, AI in `src/services/`, persisted state in
`src/state/`, design tokens in `src/theme/tokens.ts`, responsive rules in
`src/theme/layout.ts`.

## Gemini engines — read this before touching any `*Engine.ts`

**All Gemini traffic goes through `services/gemini.ts` (`callGemini`). Never hand-roll a
fetch.** Model, auth, the thinking fix, error handling and JSON parsing live there once.

**One documented exception:** `modules/profile-capture/.../GeminiChatClient.kt`. The chat
bubble generates a reply inside the accessibility service, where the RN/JS context may not
exist, so it re-implements the `callGemini` request shape in Kotlin (**`thinkingLevel: "low"`
included — same load-bearing fix**). If you change the request shape or model in `gemini.ts`,
change it there too. This is the only place a Gemini fetch lives outside `callGemini`, and it
exists only because JS cannot run at that moment — do not add a second one.

Four engines sit on top of it: `engine.ts` (chat screenshot), `bioEngine.ts` (bio
optimizer), `profileEngine.ts` (profile scan), `feedEngine.ts` (daily Discover
lines). Each contributes only a system prompt, a `responseSchema` and mock seeds.

**`profileEngine.ts` has two modes and ONE result shape.** `'self'` coaches your own
profile; `'them'` reads someone else's and returns openers. `swipeStopper` /
`intentClarity` are generic score slots and `bioLines` holds bio lines or openers —
`PROFILE_LABELS[mode]` renames them per mode, so both modes share one schema, one engine
and one report renderer. Add a mode by extending `ScanMode`; the `Record<ScanMode, …>`
maps then fail to compile until prompt, stages, labels and mock seeds all exist.

**The `'them'` prompt's HARD RULES block is not decoration.** It analyzes a real person who
never consented: no appearance/body ratings, no protected-trait inference, no fake/catfish
verdicts, no location narrowing, no character judgements. Keep rails when editing that prompt.

**`thinkingConfig: { thinkingLevel: 'low' }` in `gemini.ts` is load-bearing — do not remove.**
`gemini-flash-latest` is a thinking model and thinking tokens count against
`maxOutputTokens`. Without it the model spends the budget thinking, returns
`finishReason: MAX_TOKENS`, the JSON comes back truncated, `JSON.parse` throws — and the
engine **silently falls back to mock data**. Symptom: "the AI ignores my screenshot / shows
canned results." `gemini.selfcheck.ts` guards this with a deliberately small token cap.

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

**Key detection:** `isLiveKey` = length ≥ 30 and no "mock" substring. Google issues both
`AIza…` and `AQ.…` formats; both go in the `x-goog-api-key` header, never the URL.

**Adding an engine:** write a system prompt + `responseSchema` (uppercase OpenAPI types) +
mock seeds, then call `callGemini<T>({ system, parts, schema })`. Use `imagePart()` for
vision. Verify against the live API before wiring UI.

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

**Build keys come from the EAS environment, not `.env`.** `.env` is gitignored so it never
reaches EAS. A build profile only loads them if it declares `"environment"` — `preview` and
`production` do. Drop that field and the build still succeeds, with no Gemini key baked in:
`isLiveKey` reads stub and every engine silently serves mock data. `eas env:list
--environment preview` before blaming the model. `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is
intentionally absent, so preview builds hand out Pro free — set it before production.

**`runtimeVersion` is `appVersion` — and that is now YOUR responsibility to police.**
It was `fingerprint`, which is safer and was unusable in practice: every native or dependency
change minted a fresh runtime version and orphaned every installed build, so each OTA landed
on zero devices until a new APK was built and reinstalled. Three builds in one morning had
three fingerprints and an update matched none of them.

Under `appVersion` every build sharing `version` (`app.json`, currently `1.0.1` — bumped when
rotation and tablet support were enabled) accepts the
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

**Native is CNG.** `/android` and `/ios` are ignored by git AND EAS and regenerated from
`app.json` each build. Editing `android/` locally does nothing — use `app.json` or a plugin.

## Checks

```bash
npx tsc --noEmit                                        # must pass
node src/state/limits.selfcheck.ts                      # swipe-allowance + store-key rules
node --env-file=.env src/services/gemini.selfcheck.ts   # live API (1 tiny call)
```

`*.selfcheck.ts` are framework-free Node scripts (Node 24 strips types natively) and are
excluded from `tsconfig.json`. Add one next to non-trivial pure logic; don't add a test
framework.

**`layout.ts` deliberately has no selfcheck.** It transitively imports `react-native` (via
`tokens.ts`), which Node cannot parse — and the alternative, duplicating the spacing values
into an import-free module, is worse than the arithmetic being unguarded. Verify layout
changes with `npx expo export --platform android`, which catches everything a type error
wouldn't.
