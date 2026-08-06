package expo.modules.profilecapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Self-check for the screen classifier — the repo's `*.selfcheck.ts` habit, in the
 * only runner that can execute Kotlin. Framework-free elsewhere; JUnit here because
 * there is no node equivalent for JVM code.
 *
 *   ./gradlew :profile-capture:testDebugUnitTest
 *
 * These lock the MECHANICS (vetoes, threshold, scoping), not the selectors. The
 * view-ids themselves are guesses about other companies' private UIs and can only
 * be validated against real apps on a device — see the README. When you replace
 * them with real ids, these tests should still pass unchanged; if a veto test ever
 * fails, the bubble is about to appear over someone's DMs.
 */
class ScreenClassifierTest {

  private fun signals(
    pkg: String,
    ids: List<String> = emptyList(),
    texts: List<String> = emptyList(),
    hasEditable: Boolean = false,
  ) = ScreenSignals(packageName = pkg, viewIds = ids, texts = texts, hasEditable = hasEditable)

  // --- Scoping --------------------------------------------------------------

  @Test
  fun `unsupported apps are never profiles`() {
    // A banking app, a browser, anything: we must not classify what we don't
    // support. (WhatsApp used to be the example here — it is now a supported
    // messenger, but chat-only; see `a messenger can never produce a profile`.)
    val r = ScreenClassifier.classify(signals("com.chase.sig.android", listOf("profile_header")))
    assertFalse(r.isProfile)
    assertEquals(0.0, r.confidence, 0.0)
  }

  @Test
  fun `an empty screen is not a profile`() {
    assertFalse(ScreenClassifier.classify(signals(ScreenClassifier.INSTAGRAM)).isProfile)
  }

  // --- Vetoes: the privacy guarantee ---------------------------------------
  // A bubble over a DM thread is a privacy incident even though we capture
  // nothing. These MUST stay false even when profile-ish chrome is present.

  @Test
  fun `instagram reels never trigger, even with profile chrome present`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("clips_viewer_view_pager", "profile_header", "username"),
        texts = listOf("follow", "1.2m", "500", "340", "followers", "following", "posts"),
      )
    )
    assertFalse("a reel must never be classified as a profile", r.isProfile)
  }

  @Test
  fun `instagram DMs never trigger`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("direct_thread_toggle", "profile_header", "username"),
        texts = listOf("message", "active now"),
      )
    )
    assertFalse("a DM thread must never be classified as a profile", r.isProfile)
  }

  @Test
  fun `instagram stories never trigger`() {
    val r = ScreenClassifier.classify(
      signals(ScreenClassifier.INSTAGRAM, ids = listOf("story_viewer_root", "username"))
    )
    assertFalse(r.isProfile)
  }

  @Test
  fun `tinder chat never triggers`() {
    val r = ScreenClassifier.classify(
      signals(ScreenClassifier.TINDER, ids = listOf("chat_input", "profile_name_age"), texts = listOf("maya, 26"))
    )
    assertFalse(r.isProfile)
  }

  @Test
  fun `ordinary facebook is out of scope - only dating is supported`() {
    val r = ScreenClassifier.classify(
      signals(ScreenClassifier.FACEBOOK, ids = listOf("profile_header"), texts = listOf("john, 30"))
    )
    assertFalse("plain Facebook must not be read — only Dating is in scope", r.isProfile)
  }

  // --- Positive detection ---------------------------------------------------

  @Test
  fun `a full instagram profile is detected`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("row_profile_header_container", "profile_header_username", "highlights_tray"),
        texts = listOf("142", "1.2k", "384", "posts", "followers", "following", "follow", "message"),
      )
    )
    assertTrue("a real profile should clear the threshold", r.isProfile)
    assertTrue(r.confidence >= ScreenClassifier.THRESHOLD)
  }

  @Test
  fun `a tinder profile card is detected`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.TINDER,
        ids = listOf("user_rec_card_content", "profile_bio"),
        texts = listOf("maya, 26", "like", "nope"),
      )
    )
    assertTrue(r.isProfile)
  }

  // --- Own profile vs someone else's ---------------------------------------
  // The bubble shows on ANY profile. Getting this wrong means the app asks Gemini
  // to write pickup lines about the user themselves, and it (correctly) refuses —
  // which reads to the user as "the button is broken".

  @Test
  fun `your own instagram profile is flagged as your own`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("row_profile_header_container", "profile_header_username"),
        texts = listOf("8", "453", "603", "posts", "followers", "following", "edit profile", "share profile"),
      )
    )
    assertTrue("still a profile", r.isProfile)
    assertTrue("Edit profile means it is the user's own", r.isOwnProfile)
  }

  @Test
  fun `someone else's instagram profile is not flagged as your own`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("row_profile_header_container", "profile_header_username"),
        texts = listOf("142", "1.2k", "384", "posts", "followers", "following", "follow", "message"),
      )
    )
    assertTrue(r.isProfile)
    assertFalse("Follow/Message means it is someone else's", r.isOwnProfile)
  }

  // --- Chat detection -------------------------------------------------------
  // A chat must NEVER read as a profile (the veto still holds), and only an OPEN
  // conversation — a chat surface AND a compose field — offers a reply.

  @Test
  fun `an open instagram dm with a composer is a chat, never a profile`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("direct_thread_recycler", "message_composer_edit_text"),
        texts = listOf("message…", "active now"),
        hasEditable = true,
      )
    )
    assertFalse("a chat is never a profile", r.isProfile)
    assertEquals(ScreenKind.CHAT, r.kind)
  }

  @Test
  fun `an open tinder chat with a composer is a chat`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.TINDER,
        ids = listOf("chat_message_list", "chat_input"),
        texts = listOf("type a message"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.CHAT, r.kind)
    assertFalse(r.isProfile)
  }

  @Test
  fun `an inbox list without a composer is not a chat`() {
    // The matches/inbox screen carries chat ids but no open thread to reply in —
    // firing here would put the bubble over a list of previews.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("direct_thread_list", "messages_inbox"),
        texts = listOf("messages"),
        hasEditable = false,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `the count row is recognised when count and label share one node`() {
    // Instagram renders "1,234\nposts" as a single node, which defeated both the
    // COUNT regex and the exact-match label check — so the strongest structural
    // signal scored zero on a modern profile.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("profile_header"),
        texts = listOf("142\nposts", "1,234 followers", "384 following", "follow"),
      )
    )
    assertTrue("composite count nodes still score the row", r.isProfile)
  }

  @Test
  fun `a private profile with no post count still clears the threshold`() {
    // Two composite nodes, not three: a private account hides the grid and its
    // count. This case used to land exactly ON 0.75, one id drift from silence.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("profile_header", "username"),
        texts = listOf("1,234 followers", "384 following", "follow"),
      )
    )
    assertTrue(r.isProfile)
  }

  @Test
  fun `hinge is detected structurally, without any prompt copy`() {
    // The old scorer needed one of three hardcoded English prompt headings. Hinge
    // rotates its prompt library and localises it, so that bonus decayed to zero
    // and Hinge stopped being detected at all outside en-US.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.HINGE,
        ids = listOf("subject_card", "prompt_container", "like_button"),
        texts = listOf("maya, 26"),
      )
    )
    assertTrue("structure, not copy", r.isProfile)
    assertEquals(ScreenKind.PROFILE, r.kind)
  }

  @Test
  fun `a tinder own-profile tab is recognised without english copy`() {
    // No "edit profile" string anywhere — a localised build has none. The dating
    // apps previously had no own-profile ids at all, so this always read as
    // someone else's profile and the model was asked to write openers about the
    // user themselves.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.TINDER,
        ids = listOf("my_profile_container", "profile_name_age", "user_profile"),
        texts = listOf("maya, 26"),
      )
    )
    assertTrue(r.isProfile)
    assertTrue("own profile → 'self' mode, not 'them'", r.isOwnProfile)
  }

  @Test
  fun `an instagram story is never a chat, however repliable it looks`() {
    /*
     * The regression this locks. Every profile scorer vetoed `story_viewer`, but
     * chatScore had no veto at all — so a story scored a full 1.0 as a chat: the
     * reply box is editable (0.35), its placeholder is "Send message" (0.15), and
     * the composer id contains `message_composer` (0.50). The bubble appeared over
     * exactly the screen the veto list exists to keep it off.
     */
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("story_viewer_container", "message_composer_edit_text"),
        texts = listOf("send message"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `an instagram dm inbox with a search field is never a chat`() {
    // Same shape, different screen: an inbox carries chat ids AND an editable
    // search box, which cleared the threshold and put the bubble over a list of
    // other people's conversation previews.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("direct_inbox_recycler", "search_edit_text"),
        texts = listOf("search"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `a reel with its comment sheet open is never a chat`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("clips_viewer_view_pager", "message_composer_edit_text"),
        texts = listOf("message"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `a sentence containing the word message is not a composer placeholder`() {
    // The text hint was a bare contains("message"), which matched "Send message",
    // "3 new messages" and any preview row mentioning one. Length-bounded now, the
    // same way the messenger scorer already bounded its own.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("feed_recycler"),
        texts = listOf("tap here to message maya about the concert"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `plain facebook messenger is out of scope for chat`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.FACEBOOK,
        ids = listOf("thread_composer"),
        texts = listOf("message"),
        hasEditable = true,
      )
    )
    assertEquals("only Dating is in scope — not plain Messenger", ScreenKind.NONE, r.kind)
  }

  // --- General messengers ---------------------------------------------------
  // WhatsApp/Snapchat/Telegram have no profile to score, so they can only ever
  // produce CHAT. Their inbox carries an editable search field, which is exactly
  // why a composer alone is not enough there.

  @Test
  fun `an open whatsapp thread offers a reply`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.WHATSAPP,
        ids = listOf("conversation_layout", "entry"),
        texts = listOf("message"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.CHAT, r.kind)
    assertFalse("a messenger has no profile to capture", r.isProfile)
  }

  @Test
  fun `a whatsapp thread still offers a reply once the placeholder is gone`() {
    // The placeholder disappears as soon as the user types; the thread id has to
    // carry it, or the bubble would vanish mid-compose.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.WHATSAPP,
        ids = listOf("conversation_contact_name", "entry"),
        texts = listOf("hey what are you up to"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.CHAT, r.kind)
  }

  @Test
  fun `the whatsapp inbox search field is not an open thread`() {
    // The regression this design exists to prevent: the inbox is editable too.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.WHATSAPP,
        ids = listOf("search_src_text", "contact_row_container"),
        texts = listOf("search", "archived"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `an inbox preview that merely starts with message is not a composer`() {
    // "message" as a placeholder is short; as a row preview it is a sentence. The
    // length bound is what separates them, since the inbox is editable too.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.WHATSAPP,
        ids = listOf("search_src_text"),
        texts = listOf("message me when you get there ok?"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `a telegram thread is recognised by its composer placeholder`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.TELEGRAM,
        ids = emptyList(), // canvas-drawn: no useful ids to lean on
        texts = listOf("message"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.CHAT, r.kind)
  }

  @Test
  fun `a snapchat chat is recognised by its send-a-chat placeholder`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.SNAPCHAT,
        ids = emptyList(),
        texts = listOf("send a chat"),
        hasEditable = true,
      )
    )
    assertEquals(ScreenKind.CHAT, r.kind)
  }

  @Test
  fun `a messenger screen with no composer at all stays silent`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.TELEGRAM,
        ids = listOf("chat_list"),
        texts = listOf("message"),
        hasEditable = false,
      )
    )
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `a messenger can never produce a profile capture`() {
    // Profile-shaped chrome in a messenger must not open the screenshot path.
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.WHATSAPP,
        ids = listOf("profile_header", "row_profile_header"),
        texts = listOf("142", "1.2k", "384", "posts", "followers", "following"),
      )
    )
    assertFalse(r.isProfile)
    assertEquals(ScreenKind.NONE, r.kind)
  }

  @Test
  fun `a profile is never mistaken for a chat`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("row_profile_header_container", "profile_header_username", "highlights_tray"),
        texts = listOf("142", "1.2k", "384", "posts", "followers", "following", "follow", "message"),
      )
    )
    assertEquals(ScreenKind.PROFILE, r.kind)
    assertTrue(r.isProfile)
  }

  // --- Threshold ------------------------------------------------------------

  @Test
  fun `weak evidence stays below the threshold`() {
    // One lonely signal must not be enough. A missed profile costs a tap; a false
    // positive costs the install, so the bias is deliberately toward silence.
    val r = ScreenClassifier.classify(
      signals(ScreenClassifier.INSTAGRAM, ids = listOf("profile_header"))
    )
    assertFalse("a single weak signal must not fire the bubble", r.isProfile)
    assertTrue(r.confidence < ScreenClassifier.THRESHOLD)
  }

  @Test
  fun `confidence never exceeds one`() {
    val r = ScreenClassifier.classify(
      signals(
        ScreenClassifier.INSTAGRAM,
        ids = listOf("row_profile_header", "profile_header_username", "profile_tab", "highlights_tray"),
        texts = listOf("142", "1.2k", "384", "posts", "followers", "following", "follow", "edit profile"),
      )
    )
    assertTrue(r.confidence <= 1.0)
  }
}
