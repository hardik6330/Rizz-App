# RizzCoach — CTO / Architecture & Product Report

Status: assessment. Written after a full read of `src/`, `modules/profile-capture/`, the build
config and `docs/profile-analyzer-blueprint.md`. Companion to that blueprint, not a replacement
— §0 of the blueprint is still the most important page in this repo.

**A note on scope.** The brief asked for 150+ feature ideas and thirteen "top-N" lists. I have
not padded to those counts. Ranked lists stop where the ideas stop being worth building, because
a list padded to a number is a list you cannot act on. Everything below is grounded in code I
read or a source I checked; where I am speculating, I say so. If you want a specific section
expanded to full breadth, ask and I will expand that one.

---

# Part 1 — What this system actually is

## 1.1 Shape

An Expo SDK 57 / RN 0.86 / React 19 app, ~6,000 lines of TypeScript across 11 screens and 21
components, plus ~1,650 lines of Kotlin implementing an Android AccessibilityService. **There is
no backend.** Every AI call goes direct from device to Google's Generative Language API.

```
┌──────────────────────────── Android device ──────────────────────────────┐
│                                                                           │
│  ┌─ RizzCoach app (RN) ──────────────┐   ┌─ AccessibilityService ──────┐ │
│  │                                    │   │  (own process, no JS)       │ │
│  │  (tabs)/index      Lab             │   │                             │ │
│  │  (tabs)/profile    Profile Scan    │   │  ScreenClassifier           │ │
│  │  (tabs)/bio        Bio Lab         │   │    ↓ PROFILE | CHAT | NONE  │ │
│  │  (tabs)/discover   Feed            │   │  OverlayController (✨)     │ │
│  │  vault / analyzer / paywall        │   │    ↓ tap                    │ │
│  │           ↓                        │   │  ┌──────────┬────────────┐  │ │
│  │  services/gemini.ts  callGemini<T> │   │  │ PROFILE  │   CHAT     │  │ │
│  │    ↑ engine  bio  profile  feed    │   │  │ screenshot│ read tree │  │ │
│  │           ↓                        │   │  │ → Capture │ → Gemini  │  │ │
│  │  state/useRizzStore (Zustand)      │   │  │   Store   │   (Kotlin)│  │ │
│  │           ↓                        │   │  │ → launch  │ → clipboard│ │ │
│  │  state/storage.ts → MMKV           │   │  └────┬─────┴──────┬─────┘  │ │
│  │  services/purchases → RevenueCat   │◄───pull───┘            │        │ │
│  └────────────────────────────────────┘   └───────────────────┼────────┘ │
└────────────────────────────────────────────────────────────────┼──────────┘
                          │                                      │
                          └──────────► Google Gemini ◄───────────┘
                                  (API key lives in BOTH)
```

## 1.2 The five architectural decisions that define this codebase

Each is deliberate, documented, and correct. They are the reason this is maintainable.

**1. One AI transport.** `services/gemini.ts::callGemini<T>` is the sole HTTP path. Model, auth,
the `thinkingLevel: 'low'` fix, error handling and JSON parsing exist once. Four engines
(`engine`, `bioEngine`, `profileEngine`, `feedEngine`) contribute only a system prompt, a
`responseSchema` and mock seeds. Adding a fifth engine is a file, not a refactor.

**2. The native layer contains no business rules.** `ScreenClassifier` answers "what screen is
this"; `RizzAccessibilityService` answers "here are the pixels". Whether the user has credits is
decided in `useOutOfCredits`, in TypeScript, next to the self-checked `limits.ts`. When the chat
bubble genuinely could not reach JS, the team did *not* reimplement the freemium rule in Kotlin —
they built `ChatEntitlement`, a two-scalar snapshot JS overwrites whole on every resume. That is
the right call and it is why there is no second `limits.ts` bug waiting in Kotlin.

**3. One result shape for two profile modes.** `ProfileScanResult` has generic score slots
(`swipeStopper`, `intentClarity`) that `PROFILE_LABELS[mode]` renames, and `bioLines` that carries
bio lines in `'self'` and openers in `'them'`. One schema, one engine, one renderer, two products.
`Record<ScanMode, …>` makes adding a mode a compile error until every map is filled.

**4. `ProfileCapture` is the seam.** Everything past `images` is optional, so a gallery pick, a
share-sheet intent and an accessibility capture all produce the same type. This is what made v2
(chat) cheap and what will make v3 cheap.

**5. Everything degrades to a working demo.** No Gemini key → mock seeds. No MMKV (Expo Go) →
in-memory Map. No RevenueCat → mock plans and a fake purchase sheet. No native module (iOS/web) →
`isSupported` false and every export no-ops. The app is never broken; it is only ever less live.

That last one is also the single most dangerous property in the codebase. See §2.3.

## 1.3 Data, money and permission flows

**Credit flow.** `FREE_ANALYSIS_LIMIT = 3`, lifetime, shared by Lab / Bio / Profile Scan. Held in
`analysisCount` in MMKV. Rejected work does not charge — `profile.tsx` checks `isProfile` and
returns before `incrementAnalysis()`; `GeminiChatClient` returning null skips `recordConsumed`.
The native chat path burns against the same pool via the `configureChat` / `consumeChatUsage`
round trip in `_layout.tsx`. `FREE_SWIPE_LIMIT = 10`, per day, Discover only, rolled over by
`limits.ts::nextSwipeState`.

**Revenue flow.** `paywall.tsx` → `purchases.ts::purchasePlan` → RevenueCat `purchasePackage` →
entitlement `pro` → `setPro(true)`. Guarded by `isLiveRevenueCatKey` (`appl_` or `goog_` prefix).

**Permission flow.** `analyzer.tsx` is the compliance surface: prominent disclosure, then two
Settings round-trips (accessibility, then overlay), then an in-app kill switch that is separate
from the OS grant. `setEnabledPersisted` writes to SharedPreferences so the switch survives
process death — a real bug that was found and fixed.

**Capture flow.** Tap ✨ → `playScan()` (400ms, and the bubble must be *gone* before the shot or
it lands in its own screenshot) → `takeScreenshot()` → downscale to 1280px → JPEG 80 → base64 →
`CaptureStore` (memory only, never disk) → launch app → `_layout.tsx` routes to `/profile` →
`consumePendingCapture()` → `analyzeProfile`.

---

# Part 2 — The four things that will hurt you

Ranked by expected cost, not by how hard they are to fix.

## 2.1 The Gemini key ships in the binary — twice

`EXPO_PUBLIC_GEMINI_API_KEY` is embedded in the JS bundle (`gemini.ts:20`) and then *pushed into
Android SharedPreferences* by `configureChat` so the service can use it (`ChatEntitlement.kt`).
Both files say so in their headers. Anyone who unzips your APK has your key.

The exposure is not theoretical and it is not bounded by your user count. A leaked
Generative Language key with no server-side quota is an open-ended bill against your Google Cloud
account, and it is discoverable by automated scanners within days of a public release.

Combined with §2.2, your free tier is effectively infinite. **This is a launch blocker, not a
backlog item.** Blueprint §5 already specifies the fix in ~100 lines.

## 2.2 Revenue on Android is zero by construction

Three facts that compose badly:

- `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` is deliberately unset (AGENTS.md says so).
- `isLiveRevenueCatKey` therefore returns false, so `configured` stays false.
- `purchasePlan` falls through to `await wait(1400); setPro(true); return true`.

Every Android user currently gets Pro, free, after a 1.4-second fake App Store sheet. This is
documented and intentional for preview builds — but it fails *silently and in the user's favour*,
which is the failure mode you never notice in testing. It must be verified against a real
`goog_` key before any store release.

Separately: `analysisCount` lives in MMKV, so a reinstall restores all three free credits. With no
server, there is no way to prevent this. Fine at zero marginal cost; not fine when each analysis is
a Gemini vision call you pay for.

## 2.3 The silent mock fallback hides total outages

Every engine catches and returns mock data. This is a genuinely good demo property and a genuinely
bad production property, and you have already been bitten: when `gemini-flash-latest` rolled to
Gemini 3, `thinkingBudget: 0` began returning HTTP 400 on *every call*, and the entire app served
canned results until a human noticed. The only place the outage was visible was the native chat
path, because it has no mock fallback.

You have no telemetry. There is no alarm that fires when 100% of AI calls fail. Right now the
detection mechanism is a user writing a review that says the AI ignores their screenshot.

## 2.4 The classifier is a maintenance treadmill with no instrumentation

`ScreenClassifier` scores unversioned, private `viewIdResourceName` fragments from eight
third-party apps that A/B test their UI continuously. The file says this plainly. The design is
about as good as this can be — scored rather than rule-based, negative signals veto, threshold at
0.75, biased hard toward showing nothing — and `ScreenClassifierTest.kt` (370 lines) pins the
behaviour.

But when Instagram renames `profile_header`, nothing fails. The bubble simply stops appearing, for
everyone, and you find out from churn. **You cannot run this feature without a "bubble shown /
bubble tapped, by app, by version" metric.** That single number is the difference between a
maintainable feature and a slow leak.

---

# Part 3 — Where the moat actually is

## 3.1 The AI is not the moat

Four prompts and a `responseSchema` against a public Gemini endpoint. Any competent team
reproduces `engine.ts` in a week. The prompts are good — the anti-slop rules in the `replies`
block ("mirror the user's own voice", "no em-dashes", "a missing full stop is normal") are better
than most shipped products, and the `them`-mode HARD RULES block is the best ethical rail I have
seen in this category. But prompts are copyable and, sitting in the client bundle, literally
extractable.

## 3.2 The moat is that the reply appears where the user already is

Every mainstream competitor makes the user leave the dating app, screenshot, switch, paste, read,
copy, switch back. Reviews of the category name this friction constantly, alongside outputs
described as *"generic, repetitive, and try-hard"*.

RizzCoach's chat bubble does something materially different: the user taps ✨ inside WhatsApp, and
a contextual reply lands on their clipboard without ever leaving the conversation. That is a
genuinely superior interaction and it is the only part of this product a competitor cannot clone
from the store listing.

## 3.3 …and you have implemented it in the single riskiest way available

The blueprint's §0 verdict stands on ToS grounds. But one part of it is now worth revisiting.

**Play policy is more permissive than §0 assumes.** The current Play Console policy on the
AccessibilityService API describes *two* paths: `isAccessibilityTool=true` (requires a video and a
disability audience — you cannot truthfully claim this), **or**, for all other uses, an
accessibility declaration in Play Console plus a prominent in-app disclosure that describes the
data accessed, explains how it is used, requires affirmative user action, and is not buried in a
privacy policy or bundled with other consent.

Read `analyzer.tsx` against that list. It is already ~90% of a compliant disclosure — the
"What this reads, and when" block is exactly the required form. The gaps are the Play Console
declaration itself and capturing an explicit affirmative consent event rather than an
informational screen plus a toggle.

**What does not go away:** Meta's and Match Group's terms prohibit automated collection from their
apps, and that survives any Play approval. And "overlay + screen-read + dating + AI" remains a
stalkerware-classifier bullseye that draws slow, repeated human review.

**So the strategic question is not "is the moat legal" — it is "is there a cheaper API that
produces the same user experience".** There is.

## 3.4 The recommendation: ship an IME, keep accessibility as power mode

An `InputMethodService` — a custom keyboard — reaches the same eight apps and produces a *better*
outcome than the current flow:

| | AccessibilityService (today) | IME (proposed) |
|---|---|---|
| Reads the conversation | Yes, via tree walk + auto-scroll | Yes, via `getExtractedText` / `InputConnection` context |
| Delivers the reply | Clipboard; user pastes | `commitText` — types it straight into the composer |
| Play declaration | Accessibility declaration + prominent disclosure | None |
| Extra permissions | `BIND_ACCESSIBILITY_SERVICE` + `SYSTEM_ALERT_WINDOW` | None |
| Third-party ToS | Automated collection from their UI | The user is typing in their own keyboard |
| Stalkerware classifier | Bullseye | Not implicated |
| Breaks when apps redesign | Constantly — private view IDs | Never — the IME contract is public and stable |
| Works on | 5 dating + 3 messaging apps you enumerate | Every text field on the device |
| iOS equivalent | Impossible | Custom keyboard extension — same product, both platforms |

Precedent exists: **Typly** ships exactly this on Google Play, covering Tinder, Bumble, Hinge,
WhatsApp, Instagram, Messenger, Telegram and Snapchat.

The IME also erases §2.4 entirely. No classifier, no selectors, no treadmill, no silent breakage
when Instagram ships a redesign.

**What you would keep from the existing work, unchanged:** `GeminiChatClient.kt` (the native
Gemini caller — an IME has no JS context either, so it needs exactly this), `ChatEntitlement.kt`
(the credit snapshot contract is identical), the tone menu concept from `OverlayController`, all
four prompts, and every rail in the `them` prompt. You would retire `ScreenClassifier`,
`OverlayController` and most of `RizzAccessibilityService`.

**What the accessibility path keeps that an IME cannot do:** capture the *profile screenshot*. An
IME cannot see the screen. So the honest split is:

- **IME → the chat/reply product.** Compliant, cross-platform, stable, better UX. Make this the
  default surface.
- **Share sheet → the profile product.** Blueprint §3 option [A], ~2 days of work, zero risk. The
  user screenshots a profile and shares it to RizzCoach. Two taps instead of one.
- **AccessibilityService → an opt-in "one-tap mode"**, shipped on a separate track behind a flag,
  exactly as blueprint §6 advises. If it is rejected or has to be pulled, the product still works.

That sequencing removes every existential risk from the critical path while *improving* the core
interaction.

---

# Part 4 — Product assessment

## 4.1 What it solves, and for whom

The stated job is "turn screenshots into second dates". The real job is narrower and more honest:
**reduce the anxiety of the blank text field.** Users are not short of matches; they are short of
the confidence to send the next message. That is why the reply cards, the roast and the A/B
simulator all exist, and why the simulator (showing what they'd probably say back) is
psychologically the smartest feature in the app.

Primary audience: men 18–30 on Tinder/Hinge/Bumble/Instagram, moderate-to-heavy match volume,
low-to-moderate reply confidence. Secondary: anyone re-entering dating who wants a profile audit.

## 4.2 Where the product is strong

- **The bubble.** Discussed above. Nothing else in the category feels like this.
- **Voice matching.** The `replies` prompt instructs the model to mirror the user's own
  capitalisation, punctuation, emoji habits and message length, and forbids em-dashes,
  semicolons and balanced two-clause sentences. This is the direct antidote to the
  "generic, try-hard, obviously-AI" complaint that dominates competitor reviews. It is the most
  underrated asset you have and it is not visible in your store listing.
- **The A/B simulator.** Consequence preview, not just generation. Genuinely differentiated.
- **Ethical rails on `them` mode.** No appearance rating, no protected-trait inference, no
  fake/catfish verdict, no location narrowing, no character judgement, refuse if the subject may
  be a minor. This is both the right thing and your best defence in a manual review.
- **Craft.** Haptics on every touchable, staged loaders, cinematic backgrounds, a floating tab
  bar. It reads as a paid product, not a wrapper.
- **The codebase itself.** Comment quality is exceptional — nearly every non-obvious line explains
  the bug that caused it. This is the cheapest maintainability investment there is and it has
  been made consistently.

## 4.3 Where users will struggle

1. **Three lifetime free credits is too few to establish value.** The user gets one screenshot
   (which buys all three modes and unlimited rerolls — a good design), then a bio, then a scan,
   and they are done forever. They hit the paywall before the habit forms. Competitors gate
   per-day, not per-lifetime.
2. **Two Settings round-trips before the headline feature works.** Accessibility, then overlay.
   `analyzer.tsx` acknowledges this is "a brutal funnel". You have no measurement of the drop-off
   at each step, so you cannot fix it. (An IME needs one round trip and it is the familiar
   "enable keyboard" flow.)
3. **The Discover feed is a retention device with no reason to return.** Fifteen AI lines a day
   plus a curated set, no personalisation, no memory of what the user saved or used. It is a
   filler feed, and users will treat it as one.
4. **Clipboard delivery is a half-step.** The reply is copied; the user must still long-press and
   paste. An IME types it.
5. **Nothing persists but the vault.** No history of past analyses, no sense of progress, no
   "your profile score went 5 → 7". A coaching product with no memory cannot demonstrate that it
   worked.

## 4.4 Monetization: honest read

Weekly $6.99 / annual $39.99 / lifetime $79.99 is the standard shape and the annual is priced
sensibly. Two structural problems:

- **Lifetime at $79.99 is a mistake for a product with a per-use COGS.** Every lifetime buyer is
  an unbounded liability against your Gemini bill. Either remove it or make it a credit pack.
- **There is no consumable tier.** The entire model is subscribe-or-nothing at credit 4. A
  $2.99 ten-credit pack converts the large segment that will never subscribe to a dating app but
  will pay for tonight's conversation.

Category evidence supports pricing tension being the dominant complaint: reviews of the leading
competitor cite high subscription cost, thin free functionality and refund difficulty as the
primary grievances. Your differentiator is real enough to support price; your *free tier* is what
needs to be more generous, not your price.

## 4.5 Retention and growth: currently absent

No push notifications, no streaks, no history, no accounts, no referral, no analytics. The only
retention mechanisms are the daily feed and the iOS widget. Growth is entirely organic-install
dependent.

The roast is the one obviously viral asset and `shareText` already ships it with an app
attribution line — but it shares as *plain text*, which is unshareable on the platforms where this
audience lives. A rendered image card is a two-day change and the single highest-leverage growth
item in this document.

---

# Part 5 — Competitive landscape

Grounded in the sources listed at the end; treat specific figures as vendor/press claims, not
audited numbers.

| Player | Approach | Strength | Weakness you can attack |
|---|---|---|---|
| **Rizz AI** | Screenshot → replies. ~10M downloads, 4.7★, Gen-Z positioning | Brand ownership of the word "rizz"; distribution | Reviews describe outputs as *generic, repetitive, try-hard*; refunds hard; thin free tier |
| **YourMove AI** | In-flow nudges, profile review | Real-time framing | Still an out-of-app round trip; web-heavy |
| **Wingman / CupidAI** | Structured coaching frameworks | Depth for engaged users | Slow, effortful, not for the blank-field moment |
| **Typly** | **Android IME** across Tinder/Bumble/Hinge/WhatsApp/IG/Messenger/Telegram/Snapchat | The compliant version of your moat, shipping today | Keyboard UX is generic; no profile analysis; no vision |
| **ReplySmooth** | Web/app reply generation, five tones | Tone control | No in-app surface at all |
| **Auto Swiper** | AccessibilityService + overlay to *automate swiping* | Proves accessibility apps do ship on Play | Automation, not coaching — far greyer than you; likely enforcement target |
| **Native (Tinder/Hinge/Bumble AI)** | First-party AI matching and prompts | Distribution, data | Will never write a user's reply for them — it degrades their own trust and safety posture |

**Read on the market.** Screenshot-in / text-out is commoditised and racing to the bottom on
price. Two defensible positions remain: *in-context delivery* (Typly, and you) and *outcome
memory* (nobody). You currently have a better version of the first and none of the second.

**The gap nobody has filled:** every product in this category is a one-shot generator. None of
them remembers the conversation from yesterday, notices that the user's opener style keeps
failing, or tells them what actually worked. That is Part 6's centre of gravity.

---

# Part 6 — Where to take the product

Organised by the categories requested. Each entry: what it is, why it fits *this* codebase, and
where it lands. Difficulty is S (≤3 days) / M (1–2 weeks) / L (3+ weeks).

## 6.0 Do these first — they are not features, they are prerequisites

| # | Item | Why | Difficulty |
|---|---|---|---|
| 1 | **Backend proxy** (blueprint §5) | Removes the key from the binary; makes server-side credits possible; lets you fix a prompt without a release | M |
| 2 | **Analytics + crash reporting** | You currently cannot see a total AI outage, funnel drop-off, or a broken classifier | S |
| 3 | **AI-failure alarm** | The mock fallback must emit an event, not just a `console.warn` | S |
| 4 | **`goog_` RevenueCat key verified against a real purchase** | Android revenue is currently zero by construction | S |
| 5 | **Server-side credit ledger** | Reinstall currently resets the free tier | M (with #1) |
| 6 | **Bubble shown / tapped metric, per app** | The only way to know the classifier broke | S |

Nothing in the rest of this section should be started before 1–4.

## 6.1 Conversation intelligence — the strategic centre

The single biggest product idea in this report: **RizzCoach should remember the conversation.**

| Feature | What it is | Fit |
|---|---|---|
| **Thread memory** | Persist a per-match conversation record (hashed identifier, not names): tone used, replies sent, whether they replied. `ProfileCapture` already carries `uiText`; the transcript builder already exists in Kotlin | M |
| **"What worked" report** | Weekly: which of your openers got replies, which tone performs best for you. The first genuinely personal insight in the category | M |
| **Ghost detector** | Thread has gone quiet N days → offer a Recovery line. `FeedCategory` already has `Recovery` | S |
| **Conversation health score** | Momentum, question balance, response latency, who is carrying it. Runs on the transcript you already scrape | M |
| **Escalation coach** | Detects the moment to ask them out and says so. This is the actual outcome users want and nobody ships it | M |
| **Reply timing advice** | "They replied in 4 minutes twice; don't wait 3 hours" — derived from data you can already read | S |
| **Multi-match triage** | Which of your open threads is most worth your attention today | M |

Why this wins: it converts a one-shot generator into a system with accumulated, personal value. It
is the only feature class here that gets *better the longer someone uses it*, which is the
definition of retention, and it is the only one a competitor cannot ship by copying your screen.

## 6.2 The keyboard (see §3.4)

| Feature | Fit |
|---|---|
| **RizzCoach Keyboard (Android IME)** — reply suggestions typed straight into the composer, tone row along the top | L, and the most important L in this document |
| **iOS keyboard extension** — same product, unlocks the platform your tokens and widget already target | L |
| **Rewrite-my-draft** — user types their own message, taps ✨, gets it sharpened. Enormous: it keeps the user's voice and removes the "am I outsourcing myself" objection | M |
| **Inline tone shift** — same message, warmer / funnier / more direct, without regenerating | S |

## 6.3 Profile analysis

| Feature | Fit |
|---|---|
| **Score history** — `ProfileScanResult` already has `createdAt`; persist scans and chart swipeStopper over time. Proves the product worked | S |
| **Before/after** — rescan after edits, show the delta. Directly justifies renewal | S |
| **Photo ranking** — rank the user's own photos by lead-photo suitability. Vision call over their gallery; `photoTuneUp` prompt is 80% there | M |
| **Prompt-answer rewriter** — Hinge-specific; `hinge()` in `ScreenClassifier` already knows the prompt headings | S |
| **Bio A/B** — two bios, which gets more matches, tracked over a week | M |
| **Share-sheet capture** — blueprint §3 [A]. Two days, zero risk, removes the accessibility dependency from the profile product entirely | S |

## 6.4 Retention & habit

| Feature | Fit |
|---|---|
| **Daily streak** — one analysis or one saved line per day. `swipeDate` rollover logic in `limits.ts` generalises directly | S |
| **Push: "3 new lines dropped"** — you already generate a daily batch and nobody is told. `app.config.ts` deliberately dropped the push entitlement; add it back when this ships | S |
| **Weekly wrapped** — lines saved, replies landed, best-performing tone | M |
| **Vault → practice** — resurface saved lines contextually instead of leaving them in a list | S |
| **Personalised feed** — the daily batch currently ignores everything known about the user. Feed `savedItems` categories into `feedEngine`'s prompt: one-line change, much better feed | S |

## 6.5 Viral & growth

| Feature | Fit |
|---|---|
| **Roast card as an image** — render `RoastCard` to PNG and share that, not plain text. Highest-leverage growth item in this report | S |
| **Vibe Check card as an image** — "they're 78% into you" is inherently shareable | S |
| **Referral: 3 free credits each** — fixes the too-thin free tier and buys installs in the same change | S (needs backend) |
| **Anonymous line leaderboard** — which community lines actually get replies; turns the feed from filler into data | M |
| **"Rate my opener" duel** — two lines, community votes | M |

## 6.6 Monetization

| Feature | Fit |
|---|---|
| **Credit packs ($2.99 / 10)** — captures non-subscribers; RevenueCat supports consumables natively | S |
| **Daily free credit instead of 3 lifetime** — habit before paywall; converts better | S |
| **Retire or cap Lifetime** — unbounded COGS liability | S |
| **Pro-only: thread memory + weekly report** — the §6.1 features are the right subscription anchor because they compound | — |
| **Free-tier roast** — always free, always shareable, always attributed. Loss leader that markets itself | S |

## 6.7 Voice, video, experimental

Listed for completeness; none belongs on the near roadmap.

- Voice-note reply coaching (they sent a voice note — what do you say back).
- Date-conversation prep: three topics from their profile, briefed before you meet.
- Post-date debrief and read.
- Video-profile analysis (Hinge/Tinder video prompts).
- Real-time in-person coaching. This is the "v3" the blueprint explicitly warns not to pre-build.

## 6.8 Accessibility (the other meaning — and you should care)

The app is called an *accessibility* app by Android. Its own accessibility is currently thin, and
that is both an ethics problem and a review-surface problem.

| Item | Fit |
|---|---|
| Dynamic Type support end-to-end (the responsive pass capped chrome; content scales) | Done |
| Screen-reader labels on results, not just controls — `accessibilityLabel` is on buttons but result cards are unlabelled regions | S |
| `prefers-reduced-motion` — the app is animation-dense; `LockOverlay`, `GlowDropZone`, `Shimmer` and `AnalyzingOverlay` all animate indefinitely | S |
| Colour contrast audit — `textTertiary` `#6A6A78` on `ink` `#0A0A12` is ~4.3:1, below AA for small text | S |
| A light theme — `userInterfaceStyle` is hard-locked to dark | M |
| Bubble TalkBack behaviour — `contentDescription` is set; the tone menu's buttons need testing under TalkBack | S |

---

# Part 7 — Existing-app improvements

Concrete, screen by screen. All of these preserve the current design language.

**Lab (`(tabs)/index.tsx`)** — Analysis results are lost on unmount; add them to `partialize` and
show a "recent" row. The reroll button gives no indication it is free; label it. `charged.current`
resets on reset, so a user who resets and re-picks the same screenshot pays twice.

**Profile Scan (`(tabs)/profile.tsx`)** — The 927-line file mixes screen and report; extract
`ScanReport` into `components/ScanReport.tsx`. No score history (§6.3). The analyzer entry row is
the only discovery path for the headline feature on a device where it was skipped at onboarding —
it deserves more than a list row.

**Bio Lab (`(tabs)/bio.tsx`)** — Interests are a fixed list of eight; the custom field is a
comma-separated string, which is a poor input. No memory of last selection. Results replace the
form entirely, so tweaking one interest means re-picking all of them.

**Discover (`(tabs)/discover.tsx`)** — `EndCard` is reached in ten swipes on the free tier and the
paywall auto-pushes at 420ms, which reads as aggressive. `successRate` is model-invented and
presented as fact — either ground it or reframe it as a vibe, because a fabricated statistic is a
store-review liability. No pull-to-refresh.

**Vault (`vault.tsx`)** — No search. No reordering. `clearVault` is destructive with no
confirmation and no undo — the toast says "Vault cleared" after the fact. Add a confirm.

**Paywall (`paywall.tsx`)** — The 1.4s delayed close is a dark pattern that App Review sometimes
flags; 1.4s is short enough to be defensible but it is worth knowing. No trial messaging. No
per-plan value framing beyond `sub`.

**Analyzer (`analyzer.tsx`)** — The compliance surface, and good. Two additions for the Play
declaration: an explicit affirmative-consent action (a button that says "I understand — enable",
not a toggle after an informational screen), and a visible link to the privacy policy naming
Google as the processor.

**Bubble (`OverlayController.kt`)** — The tone menu buttons have no pressed state and no haptic.
The close zone is well built. The bubble's initial position is hardcoded to 45% height / 140px
from the right and is not remembered between sessions.

**Cross-cutting** — Font sizes are hardcoded across screens (`31`, `14.5`, `12.5`) rather than
read from `type` in `tokens.ts`; the token scale does not currently match what is in use.
Reconciling the two is a worthwhile, self-contained change. There are no loading skeletons outside
the paywall. There is no offline state — the app silently serves mocks instead.

---

# Part 8 — Roadmap

Assumes a small team. Each version is shippable and de-risks the next.

### v1.1 — "Make it real" (4–6 weeks)
Backend proxy with the server-side key; server-side credits; analytics + crash reporting +
AI-failure alarm; verified `goog_` RevenueCat key; share-sheet profile capture; roast-as-image;
daily free credit replacing 3-lifetime; credit packs.
*Goal: the app can be launched without an unbounded bill or invisible outages.*
*Impact: revenue becomes possible on Android; every later decision becomes measurable.*

### v1.2 — "The keyboard" (6–10 weeks)
Android IME reusing `GeminiChatClient` and `ChatEntitlement`; rewrite-my-draft; inline tone shift;
accessibility path moved behind a flag on its own track.
*Goal: move the moat onto a compliant, stable, cross-platform API.*
*Impact: removes the ToS and stalkerware exposure from the critical path; better UX than today.*

### v2.0 — "It remembers" (8–12 weeks)
Thread memory; conversation health score; ghost detector; what-worked weekly report; profile score
history and before/after. Accounts (needed for cross-device memory).
*Goal: convert a generator into a coach.*
*Impact: the first real retention and the right subscription anchor.*

### v2.5 — "iOS" (6–8 weeks)
iOS keyboard extension; widget re-enabled; Apple RevenueCat key; parity on everything except
screen capture.
*Goal: the platform your design system was built for.*

### v3.0 — "Outcomes"
Escalation coach, date prep and debrief, community line performance data. Only after v2.0 proves
people keep the app past week two.

---

# Part 9 — Scorecard

Scored against "a funded seed-stage consumer AI product", not against perfection.

| Dimension | Score | Reasoning |
|---|---|---|
| **Architecture** | **8.5**/10 | The five decisions in §1.2 are genuinely good. One transport, no business rules in native, one shape for two modes, a real seam. Loses points only for having no backend tier at all |
| **Code quality** | **9**/10 | The best-commented codebase I have read at this size. Comments explain the bug, not the line. Self-checks beside pure logic. `tsc --noEmit` clean |
| **AI engineering** | **7.5**/10 | Excellent prompt craft and schema discipline; the anti-slop rules are ahead of the market. Held back by client-side keys, no evals, no prompt versioning, and a silent-fallback design that hides failure |
| **UX** | **7**/10 | The bubble is category-leading. The funnel to reach it is brutal and unmeasured; clipboard delivery is a half-step; three lifetime credits kill the habit before it forms |
| **UI** | **8.5**/10 | Coherent, premium, token-driven, well-animated. Dark-only and font sizes drifted from the token scale |
| **Accessibility (a11y)** | **5**/10 | Labels and haptics are there; contrast, reduced-motion, screen-reader regions and a light theme are not. Uncomfortable for an app built on the accessibility API |
| **Performance** | **8**/10 | MMKV, bounded tree walks (`MAX_NODES`/`MAX_DEPTH`), debounced events, mode-scoped prompts to cut tokens, `getItemLayout` on the feed. Careful work |
| **Security** | **3**/10 | The key is in the binary and in SharedPreferences. Credits are client-side. No attestation, no rate limit, no server. Everything else (no disk writes, no image persistence, TLS only) is good — which makes the key the whole score |
| **Scalability** | **4**/10 | Scales to zero users beautifully. There is no server to scale, no cost control, no cache, and per-user COGS is unbounded |
| **Maintainability** | **8**/10 | Would be 9.5 without `ScreenClassifier`, which is unavoidable maintenance debt against eight moving third-party targets, with no instrumentation to know when it breaks |
| **Innovation** | **8.5**/10 | In-context reply delivery and the A/B consequence simulator are real. Voice-mirroring is quietly the best idea in the app |
| **Monetization** | **4**/10 | Android currently gives Pro away. No consumables. Lifetime tier is a COGS liability. Free tier too thin to convert |
| **Market fit** | **7**/10 | Real, large, proven-to-pay market. Crowded and commoditising at the screenshot-in/text-out layer, where most of this product currently sits |

**Weighted overall: 6.8/10** — an unusually well-engineered client wrapped around three unshipped
prerequisites (backend, billing, telemetry) and one strategically misplaced moat.

---

# Part 10 — The five things I would do

If I could only do five:

1. **Put a proxy in front of Gemini.** Everything else is optional until the key is off the
   device. Blueprint §5 has the design.
2. **Add analytics and an AI-failure alarm.** You are flying blind through a funnel you already
   describe as brutal, on a classifier that breaks silently.
3. **Build the keyboard.** It is the same moat on a stable, compliant, cross-platform API, with a
   better interaction and none of the ToS exposure. Keep the accessibility path as opt-in power
   mode on its own track.
4. **Make the product remember.** Thread memory and a weekly "what actually worked" is the only
   feature class in this category that compounds, and nobody has it.
5. **Fix the free tier and the Android key.** One free credit a day beats three forever, and
   Android revenue is currently zero by construction.

**What I would explicitly not do:** rebuild the UI, add a design-system abstraction layer,
introduce a state library beyond Zustand, add a test framework, or pre-build anything for the
"live AI" v3. The client is the healthiest part of this system. The gap is everything behind it.

---

## Sources

Market and policy claims above are drawn from:

- [Best AI Dating Assistants in 2026 — piercr](https://www.piercr.com/blog/best-ai-dating-assistants)
- [Best AI Dating Apps 2026 — CupidAI](https://getcupid.ai/blog/editorial/best-ai-dating-apps-2026)
- [Best Rizz App 2026: 7 Apps Compared — RizzAgent](https://rizzagentai.com/blog/best-rizz-app-2026)
- [Rizz AI Review 2026 — GetMatches](https://getmatches.ai/en/blog/rizz-ai-review)
- [Rizz App Customer Feedback Report — Kimola](https://kimola.com/reports/unlock-insights-rizz-app-customer-feedback-report-google-play-en-us-140697)
- [Rizz App Review — SwipeStats](https://www.swipestats.io/blog/rizz-app-review)
- [Typly AI Dating — Google Play](https://play.google.com/store/apps/details?id=com.typly.app&hl=en_US)
- [ReplySmooth — Reply Suggestions](https://replysmooth.com/features/reply-suggestions/)
- [Auto Swiper](https://auto-swiper.ch/)
- [Use of the AccessibilityService API — Play Console Help](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
- [Permissions and APIs that Access Sensitive Information — Play Console Help](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en)

Vendor download counts, ratings and percentage claims are as reported by those sources and are not
independently verified.
