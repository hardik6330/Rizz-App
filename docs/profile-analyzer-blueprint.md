# One-Tap Profile Analyzer — Architecture Blueprint

Status: design, not approved. Read "Verdict" first; it may cancel most of this document.

---

## 0. Verdict (read before Phase 1)

The requested architecture — AccessibilityService monitoring Instagram/Tinder/Bumble/Hinge,
floating overlay, screen capture, AI report — is **buildable in ~8–11 weeks and has a high
probability of never reaching production**. Two independent blockers, either one fatal:

**Blocker 1 — Google Play Accessibility API policy.** The API may only be used for
functionality that serves users with disabilities, or for a use case with no alternative API
and a prominent disclosure. "Read another app's screen so an AI can score a stranger's dating
profile" is neither. Review is manual, the declaration form asks you to state the
accessibility purpose in writing, and there is no truthful answer. Rejection here is not a
fixable-by-iteration rejection; repeated submissions risk account-level enforcement.

**Blocker 2 — third-party Terms of Service.** Instagram (Meta) and Tinder/Hinge (Match Group)
both prohibit automated collection of profile data. This is independent of Play and survives
any Play approval. It is a legal exposure, not a review-queue exposure.

**The compliant MVP that ships in ~1–2 weeks:**

> User screenshots a profile → Android share sheet → RizzCoach → report.

Two taps instead of one. Zero accessibility service, zero overlay, zero MediaProjection, zero
foreground service, zero new permissions, no Play declaration, no ToS violation (the user is
sharing their own screenshot, which is what the share sheet is for). It reuses
`profileEngine.ts` essentially unchanged — the only new code is an intent filter and a screen.

The rest of this document assumes you have read the above and still want the accessibility
architecture. It is written so the compliant path and the accessibility path share everything
below the capture layer, so the decision can be deferred exactly once.

---

## 1. What exists today

| Concern | Where | Notes |
|---|---|---|
| Navigation | `src/app/(tabs)/` | Expo Router, `expo-router/js-tabs`, custom `FloatingTabBar`. Four tabs: Lab, Profile Scan, Bio, Discover. |
| AI transport | `src/services/gemini.ts` | Single `callGemini<T>`. `gemini-flash-latest`, `thinkingLevel: 'low'`, schema-forced JSON, throws on failure. |
| Engines | `engine.ts`, `bioEngine.ts`, `profileEngine.ts`, `feedEngine.ts` | Each = system prompt + `responseSchema` + mock seeds. All swallow errors into mock fallback. |
| State | `src/state/useRizzStore.ts` | Zustand + `persist` over MMKV (`src/state/storage.ts`). `partialize` gates what survives reload. |
| Limits | `src/state/limits.ts` | Pure. `FREE_ANALYSIS_LIMIT` = 3 lifetime, shared across all three AI tools. `FREE_SWIPE_LIMIT` = 10/day. |
| Billing | `src/services/purchases.ts` | RevenueCat, **Apple key only**, full mock mode fallback. |
| Theme | `src/theme/tokens.ts` | Dark-only. `palette`, `spacing`, `radii`, `type`, `glow()`. |
| Native | `android/` prebuilt, `MainActivity.kt` | Bare-ish workflow. Config plugins viable. Only permission declared: `RECORD_AUDIO`. |
| Backend | — | **None.** |

`profileEngine.analyzeProfile({ images })` already returns exactly the report being asked for:
`swipeStopper`, `intentClarity`, `workingAndFix`, `bioLines`, `quickWin`, `photoTuneUp`,
`competition`, plus the `isProfile` / `rejectionReason` guard.

### Limitations that this feature collides with

1. **API key in the bundle.** `EXPO_PUBLIC_*` is embedded. Today one user can burn your quota.
   With background capture, one attacker can burn it *and* replay other people's screen
   contents through your key. This must be fixed before, not after.
2. **No Play Billing.** Free-tier gating exists (`useOutOfCredits`), but on Android nothing can
   currently unlock it.
3. **Credits are client-side and lifetime.** `analysisCount` lives in MMKV. Reinstall resets it.
   Acceptable for a $0-cost mock; not acceptable once each analysis costs a Gemini vision call.
4. **The mock fallback hides live failures.** `AGENTS.md` calls this out. A background capture
   path makes it worse: a silent fallback in an overlay looks identical to a working feature.
5. **The report is written for *your own* profile.** Every prompt line says "coach them",
   "this is their own profile". Analyzing *someone else's* profile is a different product with
   different ethics and needs a separate prompt, not a tweaked one.

---

## 2. Where the feature fits

The insight that keeps this small: **the analyzer is not a new engine. It is a new *input
source* for the engine that already exists.**

```
        ┌──────────────── capture layer (new, Android-only) ────────────────┐
        │                                                                    │
        │   [A] Share sheet   (compliant, 1 week)                           │
        │   [B] Quick Settings tile + MediaProjection  (grey, 3 weeks)      │
        │   [C] AccessibilityService + overlay  (high risk, 10 weeks)       │
        │                                                                    │
        └────────────────────────────┬───────────────────────────────────────┘
                                     │  ProfileCapture { images[], uiText?, app, confidence }
                                     ▼
                    src/services/profileEngine.ts   (existing, extended)
                                     │
                                     ▼
                    src/services/gemini.ts → proxy → Gemini   (proxy is new)
                                     │
                                     ▼
                    ProfileReport  → Bottom sheet / (tabs)/profile.tsx
```

All three capture options produce the same `ProfileCapture`. Choosing [A] now does not
foreclose [C] later — that is the whole point of the seam.

### The one type that makes this work

```ts
// src/types.ts — extends the existing ProfileScanInput, does not replace it
export type SupportedApp = 'instagram' | 'tinder' | 'bumble' | 'hinge' | 'facebook-dating';

export interface ProfileCapture {
  images: ProfileImage[];          // existing type, unchanged
  app?: SupportedApp;              // known for [B]/[C], absent for [A]
  uiText?: string;                 // accessibility-derived text, [C] only
  confidence?: number;             // 0–1 screen-detection confidence, [C] only
}
```

`ProfileScanInput` becomes `ProfileCapture` with everything past `images` optional. Existing
callers (`(tabs)/profile.tsx`) keep compiling untouched.

---

## 3. The compliant MVP — option [A], share sheet

Split into two independent steps, because only the first one is free.

### Step 1 — `mode: 'them'` — ✅ BUILT

Shipped in this repo. The Profile Scan tab now carries two mode pills — "My profile" /
"Their profile" — and the second mode reuses the entire existing report renderer.

| File | Change |
|---|---|
| `src/types.ts` | `ScanMode`; `mode?` on `ProfileScanInput` (optional → existing callers untouched) |
| `src/services/profileEngine.ts` | `THEM_PROMPT`; `SYSTEM_PROMPTS` / `PROFILE_LABELS` / `PROFILE_STAGES` / `MOCK_SCANS` keyed by mode |
| `src/app/(tabs)/profile.tsx` | Mode pills, label + tint wiring |
| `src/state/limits.ts` + selfcheck | `isLiveRevenueCatKey()` — the Android billing fix |

The decision worth keeping: **one result shape for both modes.** `swipeStopper` /
`intentClarity` are generic score slots and `bioLines` holds bio lines in 'self' mode or
openers in 'them' mode — both are copy/save-to-vault strings, so the vault wiring already
works. `PROFILE_LABELS[mode]` supplies the voice. One schema, one engine, one report
renderer, zero new components. The `Record<ScanMode, …>` maps turn a half-added mode into a
compile error rather than a runtime surprise.

Verified live against Gemini with the real prompt and schema: correct `isProfile`
classification, four openers each citing a specific profile detail, and the rails held — no
appearance rating, no protected-trait inference, no authenticity verdict.

### Step 2 — share target — NOT BUILT, needs a decision

**Correction to this document's earlier estimate:** Path A is *not* zero-native. An
`ACTION_SEND` intent filter can be declared from `app.json`, but the shared image arrives in
`Intent.EXTRA_STREAM`, and **`expo-linking` only surfaces `ACTION_VIEW` data URIs — it cannot
read intent extras.** Getting `EXTRA_STREAM` requires native code. Two options:

- **`expo-share-intent` (v8.0.1)** — maintained config plugin, one dep, no hand-written Kotlin.
  But it targets older SDKs and this app is SDK 57 / RN 0.86. **Unverified** — needs a real
  device build, which is where the remaining risk sits.
- **~40 lines of Kotlin** in the existing prebuild, reading `EXTRA_STREAM` in `onNewIntent` and
  exposing it through a small module. No dep, fully yours, still needs a build to test.

Until Step 2 lands, "their profile" costs a few extra taps (open app → mode pill → pick
screenshot) rather than two. **The analysis is the product; the share target is delivery.**
Ship Step 1, find out whether anyone uses the mode at all, and only then pay for the taps.

**Time:** Step 1 done. Step 2: 2–4 days including a device build.

---

## 4. The requested architecture — option [C]

### 4.1 Android components

```
com.rizzcoach.app.capture/
├── RizzAccessibilityService.kt     AccessibilityService. Window-change events only.
├── ScreenClassifier.kt             AccessibilityNodeInfo tree → ScreenKind + confidence.
├── OverlayController.kt            TYPE_APPLICATION_OVERLAY bubble, show/hide/drag.
├── CaptureCoordinator.kt           Orchestrates: classify → screenshot → extract → handoff.
├── NodeExtractor.kt                Tree → ProfileFields (see 4.3).
└── CaptureModule.kt                Nitro/Turbo module. Kotlin ⇄ JS bridge.
```

**Expo integration:** a local config plugin (`plugins/withCapture.js`) that injects the
`<service>` block, the overlay permission, and the foreground-service declaration into
`AndroidManifest.xml`, plus `res/xml/accessibility_service_config.xml`. The Kotlin lives under
`android/app/src/main/java/...` in the committed prebuild — do not attempt this from managed
workflow.

**Why not MediaProjection:** `AccessibilityService.takeScreenshot(displayId, executor, callback)`
(API 30+, requires `canTakeScreenshot` in the service config) captures the screen with **no
MediaProjection session, no per-session consent dialog, no persistent capture notification, and
no foreground service**. It deletes an entire phase from the requested plan. It does not delete
the policy problem — arguably it deepens it, because it is the flag Play scrutinises hardest.

### 4.2 Screen detection

The requested design classifies Home / Reel / Feed / Search / Chat / Profile / Story / Post /
Explore for five apps. That is ~45 classifiers to maintain against apps that A/B test their UI
weekly. **The MVP needs exactly one bit: profile, or not-profile.** Everything else is
not-profile. Build the bit; the taxonomy is v2's problem if it is ever anyone's problem.

Detection runs on `TYPE_WINDOW_STATE_CHANGED` / `TYPE_WINDOW_CONTENT_CHANGED`, debounced ~400ms,
and is a scored heuristic, not a rule:

```
score = Σ signals, fire overlay at ≥ 0.75

Instagram (package com.instagram.android):
  +0.30  view-id contains "profile_header" | "row_profile_header"
  +0.25  three sibling nodes whose text matches /^\d[\d.,KMkm]*$/ AND
         whose siblings read posts / followers / following
  +0.20  content-desc contains "Follow" | "Message" | "Edit profile"
  +0.15  a node with view-id ".*username" or ".*profile_name"
  -0.40  view-id contains "clips_viewer" | "reel" | "direct_thread" | "story"

Tinder (com.tinder):
  +0.35  view-id "profile_name_age" | text matching /^\S+,\s*\d{2}$/
  +0.25  "recCard" | "userRecCardView" in view-id
  +0.20  Like/Nope/Superlike button content-descs present
  -0.40  "chat" | "matches_list" in view-id

Bumble (com.bumble.app), Hinge (co.hinge.app), FB Dating (com.facebook.dating within katana):
  same shape; signals must be re-derived per app per release.
```

**False positives are the product risk, not the engineering risk.** A bubble that appears over
a DM thread is a privacy incident in the user's mind even if you capture nothing. Bias the
threshold high; a missed profile costs a tap, a false positive costs the install.

**Maintenance reality:** these selectors are unversioned private implementation details of
other companies' apps. Instagram ships weekly. Expect to be broken, silently, roughly monthly,
per app, forever. Budget a person for this or do not start. This is the cost nobody puts in the
estimate and it is larger than the build.

### 4.3 Field extraction — honest reliability

| Field | Source | Reliability | Fallback |
|---|---|---|---|
| Username | node view-id `*username` | High (IG), N/A (Tinder/Hinge) | screenshot OCR by Gemini |
| Display name | header text node | High | screenshot |
| Bio | multi-line text under header | **Medium** — truncated by "… more" | screenshot; expand not attempted |
| Followers / Following / Posts | the 3-count row | High (IG only) | screenshot |
| Verified badge | content-desc "Verified" | High | screenshot |
| Business / Creator label | category text node | Medium | screenshot |
| Buttons | clickable node content-descs | High | — |
| Highlights | horizontal RecyclerView content-descs | Medium — titles only, no content | — |
| Visible photos | **not available** | **None** | screenshot only |
| Interests / prompts | text nodes (Hinge/Bumble) | Medium | screenshot |
| Emojis | inside bio text | High if bio is | — |
| Links | `*bio_link*` text | Medium | screenshot |
| Mutual friends | text "Followed by X" | Low | screenshot |
| Relationship indicators | **inference only** | **None** | AI from bio/photos |
| Location | Bumble/Hinge text node | Medium | screenshot |
| Pinned content | **not available** | **None** | screenshot |
| Tabs | tab content-descs | High | — |
| Story indicator | avatar content-desc "…'s story" | Medium | — |

**The pattern:** the accessibility tree gives you *text you already have in the screenshot*, and
gives you **nothing** about photos — which is where `photoTuneUp`, `swipeStopper`, and most of
the report's value comes from. Gemini reads text out of a screenshot competently.

So: **the accessibility tree's marginal value over the screenshot alone is small.** Its real
value is *detection* (knowing when to show the bubble), not *extraction*. Pass `uiText` as a
hint to disambiguate low-contrast text, never as the primary input, and never build a parser
that the report depends on. If the tree is empty, the report should be unaffected.

This is also the strongest technical argument for option [A]: you lose the detection, which is
the only thing accessibility was actually buying.

### 4.4 Overlay

- `TYPE_APPLICATION_OVERLAY`, `FLAG_NOT_FOCUSABLE | FLAG_LAYOUT_NO_LIMITS`, 56dp FAB.
- Position: right edge, 40% height. Draggable, snaps to nearest edge, position persisted.
- Enter: fade + 200ms scale from 0.8. Exit on non-profile: fade 150ms.
- Auto-hide after 8s idle → collapse to a 20dp edge nub; tap re-expands.
- Long-press → "Hide for this app today".
- Requires `SYSTEM_ALERT_WINDOW` via `ACTION_MANAGE_OVERLAY_PERMISSION` — a Settings round-trip,
  separate from the accessibility round-trip. Two Settings trips before first value is a brutal
  onboarding funnel; measure drop-off at each.
- Must not overlap the host app's nav. Never render over a keyboard.
- Dark/light: the overlay sits over *someone else's* app, so it follows the system theme, not
  `tokens.ts`. This is the one place the "read tokens, never hardcode" rule bends — use
  `palette.violet` for the brand mark only.
- Accessibility of the overlay itself: 48dp touch target minimum, `contentDescription`
  "Analyze this profile with RizzCoach", must be reachable by TalkBack. (Note the irony: an
  accessibility-API feature that is itself inaccessible is a guaranteed review flag.)

### 4.5 Capture

`AccessibilityService.takeScreenshot()` → `HardwareBuffer` → `Bitmap`.

- Crop status bar + nav bar (`WindowInsets`).
- Downscale longest edge to 1280px. JPEG q80. Typical ~180KB.
- Never touch disk. `Bitmap` → base64 in memory → hand to JS → `bitmap.recycle()`.
- Rate limit: `takeScreenshot` is throttled by the framework (~1/s). Coalesce.
- Failure: `ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR` → toast "Couldn't read the screen", no retry
  loop. `ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY` → disable the bubble for the session.
- **Never capture without a tap.** No pre-emptive capture, no capture-on-detect, no buffer. The
  tap is the consent event. Anything else is spyware in behaviour regardless of intent.
- Battery: the service does zero work when the foreground package is unsupported — return
  immediately on `event.packageName`. Set `packageNames` in the service config to the five
  supported apps so the framework filters for you and the process stays cold elsewhere. This is
  both a battery win and your single best compliance artifact.

### 4.6 AI pipeline

Input: screenshot (always) + `uiText` (hint, optional). Output: `ProfileReport`.

**Prompt structure** — mirror `profileEngine.ts` exactly:

1. Role + task.
2. **Classification gate first.** `isProfile` boolean, `rejectionReason` string. Model returns
   early on anything that isn't a profile. This already exists and already correctly guards
   `incrementAnalysis()` — keep that invariant.
3. Field-by-field instructions, one line each, each naming the output key.
4. Safety rail. The existing one — "never body-shame or comment on protected traits" — is
   written for self-coaching and is **not sufficient** when the subject is a stranger who did
   not consent. Needs: no inferring sexual orientation / religion / ethnicity / health, no
   "authenticity" verdicts about a real person, no location-narrowing.
5. `uiText` appended as: "Text extracted from the screen, use only to disambiguate the image;
   the image is authoritative."

**On the requested report sections:** `redFlags`, `warningIndicators`, `profileAuthenticity`,
and `compatibilitySignals` are asking an LLM to render judgment on a real, non-consenting
person from one screenshot. `profileAuthenticity` in particular is a fake-detection claim with
no evidence base — it will be confidently wrong, and being confidently wrong about "is this
person real" is how someone gets harassed. `AGENTS.md`'s own disclaimer already concedes the
model is guessing. Ship: score, first impression, bio review, photo review, strengths,
conversation starters, improvement suggestions. Cut authenticity. Reframe red flags as
"things to ask about" — same signal, no verdict.

**Schema:** one `RESULT_SCHEMA`, uppercase OpenAPI types, `required` on everything non-optional
— same as `profileEngine.ts`. Reuse `callGemini<T>`. Do not hand-roll a fetch.

### 4.7 The JS/native lifecycle problem — the sharpest technical risk

**The accessibility service runs when the RN JS context does not exist.** Zustand, MMKV-backed
`analysisCount`, `useOutOfCredits`, and `isPro` are all JS-side. The service cannot ask JS
whether the user has credits, because there may be no JS.

Options:

- **(a) Native reads MMKV directly.** MMKV is a native store; Kotlin can open the same file.
  Fragile — you are now parsing Zustand's JSON envelope from two languages. It will drift.
- **(b) Bubble always shows; tapping launches the RN activity** which does the gating with the
  code that already exists. Costs an app-switch animation. Zero duplicated logic.
- **(c) Server-side credits.** Correct long-term, required once billing is real.

**Take (b) for v1, plan (c).** (b) means the native side owns *detection and capture only* and
never owns a business rule — which is exactly the seam that makes v2/v3 cheap. Do not take (a);
duplicating the freemium rule in Kotlin is how `limits.ts`'s bug happens again, in two
languages, with no self-check.

---

## 4b. Shipping — EAS Update & builds

Configured this session. Two rules that are easy to break silently:

**Keys come from the EAS environment, never from `.env`.** `.env` is gitignored, so it is not
uploaded to EAS. A build profile only loads EAS environment variables if it declares
`"environment"` — `preview` and `production` now do. Without that field the build succeeds and
produces an APK with **no Gemini key**, which `isLiveKey` reads as stub and every engine
silently serves mock data. Symptom: "the AI ignores my screenshot" on a build that compiled
fine. Check `eas env:list --environment preview` first.

`EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is deliberately NOT in the EAS environment yet, so preview
builds run billing in mock mode and testers get Pro for free. Set it before any production
build — see §5 and `isLiveRevenueCatKey()`.

**`runtimeVersion` is `fingerprint`, not `appVersion`.** Native modules are on the roadmap
(share intent, later accessibility). Under `appVersion`, publishing JS that calls a new native
module without bumping `version` delivers it to builds that lack the module and crashes them.
Fingerprint hashes the native inputs so incompatible JS is never offered.

The cost is that the local fingerprint must equal EAS's, or the build **fails** in
`CONFIGURE_EXPO_UPDATES`. The first build here failed exactly that way: Android Studio's Gradle
Buildship plugin had written Eclipse metadata (`.classpath`, `.project`, `.settings/` — 74
files) into `node_modules`, which is absent from the npm tarballs and so from EAS's clean
install. `@expo/fingerprint` ignores `build/`, `.gradle/` and `.cxx/` by default but not that;
`.fingerprintignore` closes the gap, and `npm ci` restores a clean tree. Verify with
`npx expo-updates fingerprint:generate --platform android` — the hash must equal EAS's, which
the failed build's log prints alongside a per-package diff.

Native projects are CNG: `.easignore` and `.gitignore` both exclude `/android` and `/ios`, and
EAS regenerates them from `app.json` per build. **Editing `android/` locally has no effect on
a build** — native config changes go through `app.json` or a config plugin.

---

## 5. Backend

You need one regardless of which capture option ships, because the key is in the bundle today.

**Minimum viable, ~100 lines, one Cloud Function / Worker:**

```
POST /analyze
  Auth:  RevenueCat app-user-id + a device attestation (Play Integrity)
  Body:  { image: base64, app?, uiText? }
  Does:  rate-limit → check credits → call Gemini with the SERVER-side key → return report
  Never: stores the image. Read it, forward it, drop it. No bucket, no logs of the bytes.
```

Answers to the questions asked:

- **Process accessibility data directly?** Yes — pass through as a text hint. Never persist.
- **Upload the screenshot?** Yes, in the request body, in memory, never to storage. The image is
  the input; there is no way to run Gemini vision without it leaving the device. Say so plainly
  in the privacy policy.
- **Prompts server-side?** Yes. It is your only real moat, and it lets you fix a prompt without
  a Play release. Keep the mock seeds client-side so offline demo still works.
- **Credits?** Move `analysisCount` server-side, keyed by RevenueCat app-user-id. Keep the
  client copy as an optimistic cache only. `limits.ts` stays the pure rule and gets a second
  caller; `FREE_ANALYSIS_LIMIT` gets exactly one definition, server-side, mirrored to the client
  via the response.
- **Rate limiting?** Per app-user-id, token bucket, 10/min. Plus a global daily ceiling so a
  single leaked token cannot bankrupt you overnight.
- **Caching?** Hash the image bytes → report, 24h TTL. Users re-analyze the same profile
  constantly. This is a real cost saving, not a premature optimisation.

**Also required before Android launch:** `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` and a
`goog_`-prefixed branch in `purchases.ts`'s `isLiveKey`. Currently that check is `appl_`-only,
so Android silently runs in mock mode and grants Pro for free (`purchasePlan` falls through to
`setPro(true)` after a 1.4s wait). That is a live bug the moment an Android build ships.

---

## 6. Play Store compliance checklist

| Requirement | Status under [C] | Status under [A] |
|---|---|---|
| Accessibility API used for accessibility purpose | ❌ **Fatal** | ✅ N/A |
| `isAccessibilityTool` metadata truthful | ❌ cannot be true | ✅ N/A |
| Accessibility declaration form answerable | ❌ no truthful answer | ✅ N/A |
| Prominent disclosure before permission | Required, buildable | N/A |
| `SYSTEM_ALERT_WINDOW` justified | Scrutinised, survivable | ✅ N/A |
| MediaProjection policy | ✅ avoided via `takeScreenshot` | ✅ N/A |
| Foreground service type + justification | ✅ avoided | ✅ N/A |
| Data safety form: screenshots = "Photos", transmitted | Required, truthful | Required, truthful |
| Privacy policy names Google/Gemini as processor | Required | Required |
| Third-party ToS (Meta, Match Group) | ❌ **violated** | ✅ user-initiated share |
| Target API level | Required | Required |

**Rejection risks, ranked:**

1. Accessibility policy — near-certain rejection. No mitigation exists that keeps the feature.
2. Match Group / Meta ToS — survives Play approval, arrives later as a legal letter.
3. Overlay + screen-read + dating-adjacent + AI is a stalkerware-classifier bullseye. Even a
   clean implementation gets human-reviewed slowly and repeatedly.
4. Data safety mismatch — if the form says screenshots aren't transmitted and they are, that is
   a suspension, not a rejection.
5. Analyzing non-consenting third parties may trip the Play "sensitive events / harassment"
   surface depending on report content — another reason to cut `profileAuthenticity`.

**If you attempt [C] anyway:** submit it as its own track, behind a flag, with the accessibility
declaration written by a lawyer, and never bundle it into a release that carries anything you
care about shipping.

---

## 7. Security

- **Permissions:** request at point of use, never at launch. Prominent disclosure screen *before*
  the Settings hand-off, with a plain-language "what this reads and when" — not a legal wall.
- **Local storage:** the report is text; store it in the existing MMKV vault via `partialize`.
  **Never store the screenshot.** Not encrypted-at-rest — *not stored*.
- **Image lifecycle:** `Bitmap` → JPEG → base64 → HTTPS body → `recycle()`. No file is created,
  so there is no file to delete, no `FileProvider` to leak, and no MediaStore entry. Deleting a
  temp file correctly is harder than never writing one.
- **Encryption:** TLS in flight. Nothing at rest to encrypt because nothing sensitive rests.
- **AI request security:** key server-side only; Play Integrity on the endpoint; per-user rate
  limit; no image bytes in any log line, ever, including error paths.
- **The subject's data.** The person being analyzed is not your user and never consented. Retain
  nothing about them. This is the whole security story and it is one rule: *hold the image only
  as long as the HTTP request.*

---

## 8. Roadmap & how v1 keeps v2/v3 cheap

The seam is `ProfileCapture` + "native owns detection, JS owns rules".

- **v1 — Profile analysis.** Capture layer produces `ProfileCapture`. `profileEngine` consumes it.
- **v2 — Chat analysis.** ✅ BUILT (Android). Same capture layer, new `ScreenKind.CHAT`
  (`ScreenClassifier`: a chat/conversation view-id **plus** a compose field, so an inbox list
  never fires). The bubble re-labels to "Suggest a reply". On tap the service reads the visible
  thread, auto-scrolls up a few times for history, and copies the best reply to the clipboard —
  the user just pastes and sends.

  **Deliberate deviation from this section's original sketch (round-trip via `engine.ts`):** the
  chosen product flow never leaves the host app, so JS is not in the loop at tap time. That
  forces two things the profile path avoided:
  1. **A native Gemini caller** (`GeminiChatClient.kt`) — a faithful copy of `gemini.ts`'s
     request shape (**`thinkingLevel: "low"` included, non-negotiable**). It reads chat *text*, not
     a screenshot, so no `takeScreenshot` and no image leaves the device — only the transcript.
  2. **Credits without JS present.** The freemium rule stays in TS; the service reads a
     two-scalar snapshot (`isPro`, `freeRemaining`) that JS pushes via `configureChat` on every
     resume, and JS drains the burned count via `consumeChatUsage` back into `analysisCount`.
     This is explicitly NOT §4.7 option (a) (parsing Zustand's JSON) — it's a dedicated contract
     JS overwrites whole, so nothing drifts. Failures never charge a credit.

  The disclosure copy (`analyzer.tsx` + `strings.xml`) was updated first, since it is the
  compliance surface and the behaviour changed. Everything in §0's verdict still applies — this
  path leans *harder* on the accessibility API (it now also reads message content), so the Play
  and ToS exposure is greater, not smaller.
- **v3 — Live AI / typing.** This one *does* need architecture v1 doesn't have: an IME, or
  `FLAG_INPUT_METHOD_EDITOR` event handling, plus a persistent process and streaming. It is a
  different product with a different Play category. Do not pre-build for it in v1; a
  speculative abstraction for v3 will be the wrong abstraction. The `ProfileCapture` seam is
  enough.

The single design rule that buys all of this: **the native layer never contains a business rule.**
It answers "what screen is this" and "here are the pixels". Everything else stays in TS where
`limits.ts` and its self-check already live.

---

## 9. Phased plan

Times assume one senior Android engineer + one RN engineer, and are build-only — they exclude
the perpetual selector-maintenance cost from §4.2.

### Path A — compliant (recommended)

| Phase | Work | Files | Time |
|---|---|---|---|
| A1 | Backend proxy + server-side key + rate limit + cache | new repo, `gemini.ts` swap | 4d |
| A2 | RevenueCat Google key + `isLiveKey` fix | `purchases.ts`, `constants.ts` | 1d |
| A3 | Share-target intent filter + `/analyze` route | `app.json`, `src/app/analyze.tsx` | 2d |
| A4 | `mode: 'them'` prompt + schema + safety rail | `profileEngine.ts`, `types.ts` | 2d |
| A5 | Bottom sheet UI on existing tokens | `src/components/ReportSheet.tsx` | 4d |
| A6 | Selfcheck for the new gating path + QA on 5 apps | `*.selfcheck.ts` | 2d |
| | | **Total** | **~3 weeks** |

### Path C — accessibility (if you override the verdict)

Everything in Path A, plus:

| Phase | Work | Risk | Time |
|---|---|---|---|
| C1 | AccessibilityService skeleton + config plugin + manifest | Med | 5d |
| C2 | Overlay + permission funnel + gestures | Med | 6d |
| C3 | Screen classifier, 5 apps × profile-or-not | **High** — unstable selectors | 12d |
| C4 | `takeScreenshot` + crop + compress + recycle | Low | 4d |
| C5 | Native→JS handoff, activity launch, credit gating via (b) | Med | 4d |
| C6 | Prominent disclosure, data safety, declaration, policy | **High** — may end here | 5d |
| C7 | Device matrix QA (OEM overlay quirks, OneUI/MIUI kill background services) | High | 8d |
| | | **Total** | **+8–9 weeks, then a coin flip** |

---

## 10. Open questions for the product owner

1. Is Android now the lead platform? The tokens, the widget target, and RevenueCat all say iOS.
   This feature is Android-only and cannot exist on iOS at all.
2. Does the 1 tap vs 2 taps delta justify ~8 extra weeks and the review risk? What is the
   evidence?
3. Are we comfortable shipping AI judgments about people who did not consent to being analyzed?
   That question is upstream of every technical decision in this document, and it does not have
   an engineering answer.
