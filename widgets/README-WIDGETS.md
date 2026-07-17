# Wingman Home-Screen Widget

WidgetKit extension that shows a **Daily Opener** on the iOS home screen.

## How it's wired

1. `src/services/widgetBridge.ts` picks the opener-of-the-day (deterministic by
   date) and calls `setWidgetData(json)` from `@bittingz/expo-widgets` at app
   launch. The JSON payload is `{ opener, category, updatedAt }`.
2. The config plugin entry in `app.json` copies `widgets/ios/RizzWidgets.swift`
   into a WidgetKit extension target at prebuild time.
3. `RizzWidgets.swift` decodes the payload from the shared App Group
   (`UserDefaults`) and renders it, refreshing shortly after midnight.

## Activation checklist (requires a dev build — not Expo Go)

1. In `app.json`, replace `"devTeamId": "REPLACE_WITH_APPLE_TEAM_ID"` with your
   Apple Developer Team ID.
2. Run `npx expo prebuild -p ios` then `npx expo run:ios` (or an EAS build).
3. Verify the App Group: the plugin provisions
   `group.<bundleIdentifier>.expowidgets` → `group.com.rizzcoach.app.expowidgets`.
   If your plugin version generates a different suite name, update
   `WidgetStore.appGroup` (and `dataKey`, which expo-widgets writes as
   `widgetdata`) in `RizzWidgets.swift` to match.
4. Long-press the home screen → add the **Daily Opener** widget.

If the widget shows the fallback line, the app hasn't written data yet — open
the app once so `syncDailyOpenerToWidget()` runs.
