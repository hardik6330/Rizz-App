# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# RizzCoach

Expo Router app. Screens in `src/app/(tabs)/`, AI in `src/services/`, persisted state in
`src/state/`, design tokens in `src/theme/tokens.ts`.

## Gemini engines — read this before touching any `*Engine.ts`

**All Gemini traffic goes through `services/gemini.ts` (`callGemini`). Never hand-roll a
fetch.** Model, auth, the thinking fix, error handling and JSON parsing live there once.

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

**`thinkingConfig: { thinkingBudget: 0 }` in `gemini.ts` is load-bearing — do not remove.**
`gemini-flash-latest` is a thinking model and thinking tokens count against
`maxOutputTokens`. Without it the model spends the budget thinking, returns
`finishReason: MAX_TOKENS`, the JSON comes back truncated, `JSON.parse` throws — and the
engine **silently falls back to mock data**. Symptom: "the AI ignores my screenshot / shows
canned results." `gemini.selfcheck.ts` guards this with a deliberately small token cap.

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

## Conventions

- Read tokens from `src/theme/tokens.ts`. Never hardcode hex or px in screens.
- All touchables route through `HapticPressable` so touch feel stays consistent.
- The three AI tools share `<ScreenHeader icon title tint />` (wordmark + credit meter +
  vault) and `<StagedLoader stages stage badge tint />` (text-only "thinking" card). The Lab
  uses `AnalyzingOverlay` instead — it sweeps a beam over the picked image, a genuinely
  different visual.
- Free-credit gate: `useOutOfCredits()` from the store. Don't re-derive it.
- `toast.show(msg, ms?)` — pass a longer duration for long messages (default 1.7s).
- Persisted state must be added to `partialize` in `useRizzStore.ts` or it won't survive
  reload.

## Shipping (EAS)

```bash
eas build -p android --profile preview                       # APK; needed before ANY update lands
eas update --branch preview --environment preview -m "…"     # JS-only OTA
```

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

**`runtimeVersion` is `fingerprint`.** Under `appVersion`, OTA-ing JS that calls a new native
module without bumping `version` crashes every old build.

**A fingerprint mismatch FAILS the build** in `CONFIGURE_EXPO_UPDATES` ("Runtime version
calculated on local machine … does not match EAS"). It means your `node_modules` differs from
EAS's clean install.

**Any local Android build (`expo run:android`, `./gradlew`, opening the project in Android
Studio) mutates `node_modules` and breaks the fingerprint.** Gradle and its Buildship plugin
write `build/`, `.gradle/`, `.classpath`, `.project` and `.settings/` into autolinked packages
— none of which are in the npm tarballs. Some of it the default ignores catch; some of it they
do not, and deleting the artifacts by hand does NOT reliably restore the hash.

**`npm ci` is the fix. Run it before `eas build` whenever you have built locally.**

```bash
npm ci
npx expo-updates fingerprint:generate --platform android   # .hash must equal EAS's
```

The build log prints both hashes and a per-package diff naming the culprit. `npm pack
<pkg>@<ver>` and diff its file list against `node_modules/<pkg>` if you need to see what
changed — but check for MISSING files as well as extra ones, and note the hash can differ even
when the file lists match.

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
