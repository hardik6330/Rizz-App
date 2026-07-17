# RizzCoach ⚡

A premium dark-mode iOS dating-copilot built with Expo SDK 57. Drop a chat
screenshot, get the perfect line back — plus a TikTok-style feed of
field-tested openers, a favorites vault, a home-screen widget, and a
RevenueCat paywall.

## Feature map

| Module | Where | Notes |
| --- | --- | --- |
| Screenshot Intelligence Engine | `src/app/(tabs)/index.tsx` + `src/services/engine.ts` | 3 reply styles, Vibe Check diagnosis, Roast Mode, A/B response simulator. Gemini vision when a real key is set; rich offline simulation otherwise. |
| Discovery feed | `src/app/(tabs)/discover.tsx` | Full-screen vertical paging (`snapToInterval` = window height), Higgsfield FLUX.2 backgrounds, copy/save/share rail, swipe metering. |
| Favorites Vault | `src/app/vault.tsx` (modal) | Zustand-backed, category filters, copy/share/delete, clear-all. |
| Wingman widget | `widgets/ios/RizzWidgets.swift` + `src/services/widgetBridge.ts` | Daily opener on the home screen via `@bittingz/expo-widgets`. See `widgets/README-WIDGETS.md`. |
| Paywall | `src/app/paywall.tsx` + `src/services/purchases.ts` | RevenueCat offerings + purchase/restore with a full mock mode. Triggers after 3 free analyses or 10 free swipes. |

## Stack

Expo SDK 57 · Expo Router v6 (`src/app`) · Reanimated 4 · Zustand 5 +
MMKV 4 (in-memory fallback for Expo Go/web) · expo-haptics ·
react-native-purchases 10 · Google Gemini (REST, `gemini-2.5-flash`).

Design tokens live in `src/theme/tokens.ts` — every component reads from them.

## Run it

```bash
npm install
npx expo start        # press i for iOS simulator, or scan with Expo Go
```

Expo Go works out of the box (MMKV/RevenueCat/widget fall back to safe mocks).
For the real native modules, make a dev build: `npx expo run:ios`.

## Environment

Copy `.env.example` → `.env`. Ships with stubbed keys so everything runs in
demo mode:

- `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` — RevenueCat public Apple SDK key.
- `EXPO_PUBLIC_GEMINI_API_KEY` — enables live screenshot analysis
  (Google AI Studio key, starts with `AIza`). ⚠️ Move this behind a server
  proxy before shipping (`src/services/engine.ts`).

## Generated assets

`assets/generated/` was produced with Higgsfield — FLUX.2 for the three
cinematic gradient backgrounds + app icon, Soul 2.0 for the four persona
avatars. `src/data/assets.ts` documents the asset ↔ persona mapping.

## Manual integrations required

1. RevenueCat: create the app + `pro` entitlement + weekly/annual/lifetime
   products, paste the real `appl_…` key into `.env`.
2. Gemini: real API key from Google AI Studio (ideally via your own proxy endpoint).
3. Widgets: Apple Team ID in `app.json`, then `npx expo prebuild -p ios`
   (full steps in `widgets/README-WIDGETS.md`).
4. App Store assets: Android adaptive icons still use the template art.
