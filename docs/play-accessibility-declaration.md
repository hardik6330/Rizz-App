# Play Console — AccessibilityService declaration

Everything Google asks for when submitting `RizzCoach Profile Analyzer`, plus the
evidence behind each answer. **Fill the `⟨…⟩` placeholders and read §5 before
submitting** — one answer in there is a genuine judgement call, not a form field.

This is a *non-accessibility tool* declaration. RizzCoach is not a screen reader,
switch-access, voice-input or Braille product, so `isAccessibilityTool` stays
**false** and the app is answering the "why do you need this API" questions, not
the disability-assistance ones. Claiming otherwise to reach the lighter review
path would be the fastest way to lose the developer account.

---

## 1 · The short answer Google is looking for

> RizzCoach helps people write replies in dating and messaging apps. The
> accessibility service exists so the user can get a suggested reply **without
> leaving the conversation they are already in** — it draws a floating ✨ button
> over a supported app, and when the user taps it, reads the currently visible
> screen once to produce that suggestion.
>
> It reads nothing until the user taps. It never performs actions on the user's
> behalf. It works in eight named apps and nowhere else.

## 2 · Form answers

| Field | Answer |
|---|---|
| App name | RizzCoach |
| Package | `com.rizzcoach.app` |
| Service label | RizzCoach Profile Analyzer |
| Is this an accessibility tool? | **No** |
| `isAccessibilityTool` in config | `false` |
| Core feature requiring the API | A user-triggered on-screen assistant that reads the visible conversation or profile and returns a suggested reply |
| Can the app function without it? | Yes — degraded. All four AI tools work by picking a screenshot manually. The service removes the app-switch, it does not enable the feature |
| Does it collect personal or sensitive data? | **Yes** — see §3 |
| Is data shared with third parties? | **Yes** — Google Gemini, for generation only. See §3 |
| Prominent disclosure shown? | Yes — full-screen, before any permission request. See §4 |
| Video attached? | Required. See §6 |

## 3 · Data — answer this precisely, it is where declarations fail

**What is read, and only on a tap:**

| Trigger | What is captured | Where it goes |
|---|---|---|
| ✨ tapped on a profile | One screenshot of the visible screen | `POST /v1/ai/profile` → Google Gemini → report returned to the app |
| ✨ tapped in a chat | Recent message text — the service scrolls the thread up a few steps to gather it, then restores the position. Capped at 4,000 characters | `POST /v1/ai/chat` → Google Gemini → one reply copied to the clipboard |
| Idle / scrolling / any other app | **Nothing.** View-id signals are evaluated in-process to decide whether to draw the button, and are never transmitted | — |

**Retention: none.** No screenshot, no message text and no scraped screen text is
written to disk or stored server-side. The database schema has no column that
could hold any of it — `backend/src/db/schema.ts` opens with that rule and
`docs/README.md §5.4a` states the exception list. The only durable records are
results the user explicitly asked to keep (a scan they ran, a line they
bookmarked) and a response cache held for **15 minutes** so a retry does not
charge the user twice.

**Third party:** Google Gemini, via the Gemini API, for generation only. Named
explicitly in the in-app disclosure — do not describe it as "our AI" on the form
or in the app; Apple's November 2025 rules and Google's data-safety section both
want the provider named.

**Not collected, ever:** contacts, location, identifiers of the person being
messaged, the package name of the app in view, or any content in an app outside
the list in §4. `src/services/analytics.ts` enforces this in code — `track()`
takes a closed union of events with no free-form payload, so there is no overload
through which message text could reach an analytics warehouse.

## 4 · Scope and prominent disclosure

**Eight packages, enforced by `android:packageNames` in the service config** —
an allowlist, not a filter applied afterwards. The service is never bound to any
other app.

`com.instagram.android` · `com.tinder` · `com.bumble.app` · `co.hinge.app` ·
`com.facebook.katana` · `com.whatsapp` · `com.snapchat.android` ·
`org.telegram.messenger`

**The disclosure is `src/app/analyzer.tsx`** and it is shown full-screen before
the user is sent to Settings, with an explicit affirmative action required
afterwards (a separate in-app toggle). It states, in these words:

- reads the screen of those apps only, to recognise a profile or an open chat
- acts **only** when ✨ is tapped — nothing is read in the background, ever
- what is sent to Google Gemini, and that it is discarded afterwards
- that the switch turns it off instantly

Do not reword these while the declaration is in review; the video and the form
must describe the same screen a reviewer will see.

**Three separate gates**, all required before anything is read: the OS
accessibility permission, the overlay permission, and an in-app switch that is
off by default. Granting accessibility in Settings alone does not start it.

## 5 · The policy question, answered honestly

Google's current rule: *"Any use of the Accessibility API that enables an app to
autonomously initiate, plan, and execute actions or decisions is strictly
prohibited."* Deterministic, user-triggered behaviour remains permitted.

**RizzCoach is on the permitted side, and the reasons are structural:**

| Prohibited | RizzCoach |
|---|---|
| Autonomously initiates | Every read is a tap. Drawing the ✨ button is not a read |
| Plans or executes actions | Performs **no** clicks, no text entry, no gesture dispatch, and no navigation. It scrolls — see below — and nothing else |
| Alters settings without authorisation | Changes no settings |
| Bypasses privacy safeguards | Uses only the documented API, behind all three consent gates above |
| Covert or deceptive | Draws a visible floating button; disclosure precedes every permission request; the scroll is visible to the user and is disclosed |

### ⚠️ Declare the scroll. Do not omit it.

`scrollAndRead()` in `RizzAccessibilityService.kt` performs
`ACTION_SCROLL_BACKWARD` on the host app's message list several times — reading
between each step — then `ACTION_SCROLL_FORWARD` to restore the user's position.
That is a UI action on a third-party app, and it collects conversation history
that was **not on screen** when the user tapped.

It is still on the permitted side of the policy, and the argument is specific:

- It is **user-triggered**, never autonomous — nothing scrolls until ✨ is tapped.
- It is **deterministic**: tap → scroll N → read → scroll back. This is the
  "If Trigger X occurs, perform Action Y" shape the policy explicitly allows,
  not a planner deciding what to do next.
- It uses **node scroll actions, not gesture dispatch**, so it needs no extra
  service capability.
- It **restores the user's position** afterwards, so the app is left as found.

**Say all of this on the form and show it in the video.** A reviewer who
discovers a self-scrolling screen that the declaration did not mention has found
undisclosed UI automation, and the fact that it was defensible will not matter at
that point. The disclosure in `analyzer.tsx` and §4 of the privacy policy were
both corrected to describe it — they previously said "the visible chat text",
which was not true.

⚠️ **What would flip this to prohibited: auto-send, auto-paste, tapping the
send button, or any "reply for me" mode.** The reply goes to the **clipboard**
and the user pastes it themselves. That single constraint is what separates this
from the UI-driving automation the policy bans — it is a compliance boundary, not
a UX limitation to be optimised away. `AGENTS.md` carries it as a hard rule.

**Also plan for Android 17 Advanced Protection Mode.** Non-accessibility apps
have this permission revoked automatically while AAPM is active. That is not a
policy violation and is not appealable — it is a user setting. The app must
degrade cleanly: `serviceKilled()` already distinguishes "granted but not
bound", and the copy for that state must not tell an AAPM user to toggle a
switch that will not stick.

## 6 · The video

One take, under two minutes, no edits, no voiceover needed. Screen-record on a
real device:

1. Fresh launch → the analyzer screen, scrolling slowly through the whole
   disclosure so every bullet is legible
2. Tap Step 1 → the Accessibility settings page → enable → return
3. Tap Step 2 → the overlay permission → return
4. Turn the in-app switch on
5. Open Instagram, land on a profile, wait for ✨ to appear — **do not tap it yet**,
   let the reviewer see that nothing happens on its own
6. Scroll around; show the button appearing and disappearing without any capture
7. Tap ✨ once → the report opens in RizzCoach
8. Return to the analyzer screen, turn the switch off, go back to Instagram, and
   show that ✨ no longer appears

Step 5–6 and step 8 are the ones that answer the policy question. A video that
only shows the happy path is the common reason these come back for more
information.

## 7 · Before submitting — verify each of these is still true

- [ ] `android:packageNames` lists exactly the eight packages in §4, no more
- [ ] `isAccessibilityTool="false"` in `rizz_accessibility_config.xml`
- [ ] The disclosure copy in `analyzer.tsx` matches §4 word for word
- [ ] No code path reads the screen without a tap — grep for `takeScreenshot` and
      confirm every caller is behind the ✨ handler
- [ ] The ONLY `performAction` calls are the two scrolls in `scrollAndRead` /
      `restoreScroll`. Any `ACTION_CLICK`, `ACTION_SET_TEXT` or `dispatchGesture`
      anywhere in `modules/profile-capture/` means the declaration in §5 is no
      longer true — stop and re-read the policy before submitting
- [ ] Data safety section in Play Console matches §3 — especially "shared with
      third parties: yes"
- [ ] Privacy policy at `/privacy` is reachable **logged out** and its
      accessibility section matches what the service actually reads
- [ ] `⟨support email⟩` receives mail and is the one on the store listing

## 8 · Placeholders to fill

| Placeholder | Where else it appears |
|---|---|
| `⟨legal entity name⟩` | `backend/src/routes/legal.ts` |
| `⟨registered address⟩` | `backend/src/routes/legal.ts` |
| `⟨jurisdiction⟩` | `backend/src/routes/legal.ts` |
| `⟨support email⟩` | store listing, `/privacy`, `/terms` |

These are the same values blocking the legal pages. Fill them once, in both
places, before either submission.
