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

  private fun signals(pkg: String, ids: List<String> = emptyList(), texts: List<String> = emptyList()) =
    ScreenSignals(packageName = pkg, viewIds = ids, texts = texts)

  // --- Scoping --------------------------------------------------------------

  @Test
  fun `unsupported apps are never profiles`() {
    // WhatsApp, banking apps, anything: we must not classify what we don't support.
    val r = ScreenClassifier.classify(signals("com.whatsapp", listOf("profile_header")))
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
