# Testing the one-tap analyzer

Read this in order. **The bubble will not appear on the first build** — the view-ids in
`ScreenClassifier.kt` are guesses, and Step 3 is where you replace them with real ones. Trying
to "just test it" before Step 3 will look like the feature is broken. It isn't; it's unfinished.

You need a **physical Android phone, API 30+ (Android 11+)**, with Instagram/Tinder/etc.
installed and logged in. An emulator cannot do this — `takeScreenshot()` needs API 30+ and,
more importantly, you cannot realistically log into Instagram on a fresh emulator.

---

## Step 1 — Install

Download the APK from the EAS build link, or:

```bash
adb install -r <downloaded>.apk
```

Enable "Install unknown apps" if Android objects. This is an internal-distribution APK, so it
is not from Play.

## Step 2 — Verify the plumbing (works today)

This is what the first build actually proves. None of it depends on the selectors.

1. Open RizzCoach → **Profile Scan** tab → **"Their profile"** pill.
2. Tap **"Skip the screenshot"** → the analyzer screen opens.
3. Confirm the disclosure lists the five apps and says capture only happens on a tap.
4. Tap **Step 1** → Android Accessibility settings open → find **RizzCoach Profile Analyzer**.
   - **If it is not listed, stop.** The service failed to register — that is a manifest problem,
     not a selector problem. Report it.
   - Enable it. Read Android's own warning screen; that is what your users will see.
5. Return to the app. Step 1 should now show a green check **automatically** (it re-reads on
   resume).
6. Tap **Step 2** → overlay permission → enable → return. Step 2 goes green.
7. Flip **Watch for profiles** on.

✅ If all seven pass, the service, permissions, and disclosure flow are working end to end.

Also verify the manual path still works: pick a screenshot in "Their profile" mode and confirm
you get a report with openers. That path is independent of all the native code.

## Step 3 — Fix the selectors (the actual work)

With the service enabled, open a **profile** in Instagram, then:

```bash
adb shell uiautomator dump /sdcard/d.xml && adb pull /sdcard/d.xml
grep -o 'resource-id="[^"]*"' d.xml | sort -u
```

Compare what you see against the constants in `ScreenClassifier.kt` and replace them with the
real ids.

**Do the negatives too, and do them first if you are short on time.** Dump a **reel**, a **DM
thread**, and a **story**, and make sure their real ids are in the veto lists:

| Dump this | Feeds |
|---|---|
| Profile | positive signals |
| Reel | veto — `clips_viewer` etc. |
| DM thread | veto — `direct_thread` etc. |
| Story | veto — `story_viewer` etc. |

A wrong positive selector means the bubble never shows: annoying. A wrong veto means the
bubble shows over someone's private messages: that is the one that loses you the user.

Repeat per app (Tinder, Bumble, Hinge, FB Dating). Then re-run the mechanics tests — they
should still pass unchanged:

```bash
cd android && ./gradlew :profile-capture:testDebugUnitTest
```

Add a test per app using the **real** ids as you learn them.

## Step 4 — Test detection

1. Open Instagram → someone's profile → the ✨ bubble should appear within ~half a second.
2. Scroll the profile → the bubble must **not** flicker (the signature check prevents re-adds).
3. Go to a reel / your DMs / a story → the bubble must **disappear**.
4. Switch to WhatsApp or your banking app → **no bubble, ever**. If one appears there, stop
   and fix `packageNames` before doing anything else.
5. Drag the bubble → it should move and snap to the nearest edge, and **not** fire an analyze.
6. Tap it → RizzCoach opens with the report.

## Step 5 — Test the edges

- **Out of credits**: burn all 3 free scans, then tap the bubble → you should land on the
  paywall, not a report. This proves the gate stayed in JS.
- **Kill switch**: turn "Watch for profiles" off → bubble never appears, even in Instagram.
- **Permission revoked**: revoke overlay permission in Settings while running → the app must
  not crash; the bubble just stops.
- **Rapid taps**: tap the bubble repeatedly → exactly one capture (`capturing` guard).
- **Rotation / split screen** → no crash.
- **Battery**: leave the phone idle an hour with the service on → RizzCoach should be near-zero
  in Battery usage. It only wakes for the five allowlisted apps.

## Step 6 — Watch the logs

```bash
adb logcat -s RizzA11y:* RizzOverlay:* ReactNativeJS:*
```

| Message | Meaning |
|---|---|
| `service connected` | the service bound — good |
| `takeScreenshot failed: N` | framework throttled or refused; no retry by design |
| `overlay add failed` | overlay permission gone, or an OEM refusing the window |
| `[profileEngine] live analysis failed` | **the AI silently fell back to mock data** |

That last one matters most: a live key does **not** mean you are seeing live output. If the
report looks canned, check this before anything else — every engine swallows failures into
mock data so the app demos offline.

## What will go wrong

- **Nothing appears anywhere** → selectors (Step 3). Expected on the first build.
- **Service missing from Settings** → manifest/merge problem, not selectors.
- **Bubble in the wrong place (DMs)** → veto lists; fix before showing anyone.
- **Report is generic/canned** → mock fallback; check logcat.
- **Paywall never appears** → the credit gate; `analysisCount` is client-side.
- **Works, then breaks in a few weeks** → Instagram shipped an update and renamed the ids.
  That is not a bug, that is the standing cost of this approach; see the module README.

## OEM notes

Xiaomi/MIUI, Samsung/OneUI, Huawei and OnePlus aggressively kill background services and have
extra overlay permissions buried in their own settings. If it works on a Pixel and dies on a
Xiaomi, that is why — test on at least one of each before trusting any result.
