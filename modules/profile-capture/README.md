# profile-capture

Android-only local Expo module: detects profile screens in Instagram / Tinder / Bumble /
Hinge / Facebook Dating, shows a floating ✨ Analyze bubble, and captures the screen when the
user taps it.

Lives in `modules/` (not `android/`) because `android/` is CNG — regenerated from `app.json`
on every build and gitignored. Code here is autolinked and survives `expo prebuild`.

## ⚠️ The selectors are guesses — do this first

**`ScreenClassifier.kt`'s view-ids were never validated against the real apps.** They were
written from the design blueprint, not from observation. Until someone replaces them with real
ids, the bubble will mostly not appear.

On a device with the apps installed and the service enabled:

```bash
adb shell uiautomator dump /sdcard/d.xml && adb pull /sdcard/d.xml
grep -o 'resource-id="[^"]*"' d.xml | sort -u
```

Open a profile in each app, dump, and replace the constants. Repeat for a reel, a DM and a
story too — those feed the veto lists, and getting them wrong puts the bubble over someone's
private messages.

These ids are unversioned private implementation details of other companies' apps. Instagram
ships weekly. **Expect this to break silently, roughly monthly, per app, forever.** That is
the standing cost of this feature, and it is larger than the build was.

## Checks

```bash
cd android
./gradlew :profile-capture:testDebugUnitTest    # classifier vetoes + threshold
./gradlew :profile-capture:compileDebugKotlin   # compiles
./gradlew :app:processDebugMainManifest         # service merges into the app manifest
```

The tests lock the *mechanics* (a reel is never a profile; one weak signal never fires), not
the selectors. They should keep passing after you fix the ids. If a veto test fails, the
bubble is about to appear over someone's DMs.

## Design rules — do not break these

**No business rules in Kotlin.** The service runs when the React context does not exist, so it
cannot read `useOutOfCredits`. Rather than reimplement the freemium rule in a second language
(which is how the `limits.ts` bug happens again, with no self-check), the service stashes the
capture in `CaptureStore` and launches the app. JS pulls it on resume and applies the rules it
already owns. Native answers "what screen is this" and "here are the pixels" — nothing else.
This is also what keeps v2 (chat analysis) cheap: same seam, new `ScreenKind`.

**Capture only ever happens on a tap.** No pre-emptive capture, no capture-on-detect, no
buffer. The tap is the consent event; anything else is spyware in behaviour regardless of
intent.

**Nothing touches disk.** Bitmap → JPEG → base64 → memory → HTTPS. No temp file means none to
leak and none to forget to delete.

**`takeScreenshot()`, not MediaProjection.** API 30+, needs `canTakeScreenshot` in
`rizz_accessibility_config.xml`. No consent dialog, no capture notification, no foreground
service. It is also the flag Play review scrutinises hardest.

**Two switches, not one.** Enabling the service in Settings must never by itself mean
"watching my screen" — `RizzAccessibilityService.ENABLED` is a separate in-app toggle
(`analyzer.tsx`), off by default.

**`packageNames` in the service config is the allowlist.** The framework only delivers events
for those apps, so the process stays cold everywhere else. Every entry added is surface area
to justify at review. Keep it minimal.

## Play Store reality

Read `docs/profile-analyzer-blueprint.md` §6 before submitting. Short version: Play's
Accessibility API policy limits the API to functionality serving users with disabilities, and
this is not that. Meta's and Match Group's terms separately prohibit automated profile
collection. Rejection risk is high and independent of code quality. `strings.xml`'s
`rizz_accessibility_description` and `analyzer.tsx`'s disclosure are the compliance surface —
if behaviour changes, change that copy first.
