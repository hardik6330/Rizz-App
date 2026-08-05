# RizzCoach ⚡

An AI dating-conversation coach for Android and iOS. Drop a chat screenshot, get three replies
you can actually send — plus a profile audit, a bio rewriter, a daily feed of openers, a
favourites vault, and an Android bubble that writes the reply *inside* Instagram or Tinder
without you leaving the app.

Expo SDK 57 · Expo Router v6 · Reanimated 4 · Zustand + MMKV · RevenueCat ·
a Hono API on Vercel + Railway MySQL that holds the Gemini key.

> **📖 [`docs/README.md`](docs/README.md) is the full documentation** — what the app does, an
> annotated tree of every file, the API, shipping, and a symptom→cause debugging table.
> **[`AGENTS.md`](AGENTS.md) is the rulebook** — read it before editing anything.

## What's in it

| Tool | Where | What it does |
| --- | --- | --- |
| Lab (Screenshot Scan) | `src/app/(tabs)/index.tsx` | chat screenshot → 3 replies, a vibe read, or a roast, plus an A/B response simulator |
| Profile Scan | `src/app/(tabs)/profile.tsx` | 1–3 screenshots → a scored report on your profile, or openers for someone else's |
| Bio Optimizer | `src/app/(tabs)/bio.tsx` | interests + a target vibe → 3 rewritten bios |
| Discover | `src/app/(tabs)/discover.tsx` | a daily AI feed of openers, swipeable, with a swipe limit |
| Vault | `src/app/vault.tsx` | everything you saved |
| The bubble | `modules/profile-capture/` | Android accessibility service — reply inline, never leave the host app |
| Paywall | `src/app/paywall.tsx` | RevenueCat; 3 lifetime analyses and 10 swipes/day are free |

## Run it

```bash
npm install
npx expo start                  # the app

cd backend && npm run dev       # the API (needs backend/.env)
```

Without `EXPO_PUBLIC_API_URL` pointing at a reachable API, every engine serves mock seeds and
the app demos fully offline. That fallback is silent — **a configured URL does not mean you are
seeing live output.** Check the console for `[engine] live analysis failed` first when the AI
looks canned. (`docs/README.md` §4.5.)

## Environment

`.env` is local dev only and is gitignored — **builds read the EAS environment, not this file**
(`eas env:list --environment preview`).

| Variable | Effect |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | the RizzCoach API. Unset → everything runs on mock seeds |
| `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` | `appl_…`. A stub key silently grants Pro for free |
| `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` | `goog_…`. Same, for Play |

There is **no Gemini key on the device.** It lives in `backend/.env` only — see
`backend/README.md`.

## Ship it

```bash
cd backend && vercel --prod                                  # server first
eas update --branch preview --environment preview -m "…"     # JS-only changes
eas build -p android --profile preview                       # anything native
```

**JS/TS/assets only → update. Anything native → bump `version` in `app.json`, build,
reinstall.** `runtimeVersion` is `appVersion`, so nothing catches that mistake for you.
Full shipping rules and the traps that have actually cost time: `docs/README.md` §9.

## Checks

```bash
npx tsc --noEmit
node src/state/limits.selfcheck.ts
node src/theme/contrast.selfcheck.ts
cd backend && npx tsc --noEmit
```

Plus the live ones in `docs/README.md` §10. No test framework — `*.selfcheck.ts` are
framework-free Node scripts.

## Generated assets

`assets/generated/` was produced with Higgsfield — FLUX.2 for the gradient backgrounds and app
icon, Soul 2.0 for the persona avatars. `src/data/assets.ts` documents the asset ↔ persona
mapping.

## Still manual

1. **RevenueCat** — real `appl_…` / `goog_…` keys in the EAS `production` environment. Preview
   ships stubs on purpose, which means preview builds hand out Pro for free.
2. **iOS widget** — needs `APPLE_TEAM_ID` set; the plugin attaches only when it is
   (`widgets/README-WIDGETS.md`).
3. **Play Store** — Android adaptive icons still use the template art, and the accessibility
   service needs its prominent-disclosure review (`modules/profile-capture/README.md`).
