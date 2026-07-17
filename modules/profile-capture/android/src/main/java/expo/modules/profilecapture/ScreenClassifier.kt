package expo.modules.profilecapture

/**
 * "Is the user looking at a profile?" — the ONE bit the MVP needs.
 *
 * Deliberately not a Home/Reel/Feed/Search/Story/Explore taxonomy: that would be
 * ~45 classifiers across five apps that A/B test their UI weekly. Everything that
 * is not confidently a profile is simply not-profile.
 *
 * Scored, not rule-based, because any single signal breaks on the next release.
 * NEGATIVE signals are weighted heavily and can veto: a bubble appearing over a DM
 * thread is a privacy incident in the user's mind even though we capture nothing.
 * A missed profile costs one tap; a false positive costs the install. Bias high.
 *
 * These selectors are unversioned private implementation details of other
 * companies' apps. They WILL break, silently, roughly monthly, per app. That is
 * the standing maintenance cost of this feature — see
 * docs/profile-analyzer-blueprint.md §4.2.
 *
 * Pure and dependency-free on purpose: ScreenSignals is a plain data class so this
 * can be unit-tested without an emulator (see ScreenClassifierTest).
 */

/** Flattened, app-agnostic view of the accessibility tree. */
data class ScreenSignals(
  val packageName: String,
  /** Lowercased `getViewIdResourceName()` values present on screen. */
  val viewIds: List<String> = emptyList(),
  /** Lowercased text + contentDescription values present on screen. */
  val texts: List<String> = emptyList(),
)

data class Classification(val isProfile: Boolean, val confidence: Double) {
  companion object {
    val NOT_PROFILE = Classification(false, 0.0)
  }
}

object ScreenClassifier {

  /** Fire the bubble at or above this score. High on purpose. */
  const val THRESHOLD = 0.75

  const val INSTAGRAM = "com.instagram.android"
  const val TINDER = "com.tinder"
  const val BUMBLE = "com.bumble.app"
  const val HINGE = "co.hinge.app"
  const val FACEBOOK = "com.facebook.katana"

  val SUPPORTED = setOf(INSTAGRAM, TINDER, BUMBLE, HINGE, FACEBOOK)

  /** A count like "1,234" / "12.3K" / "1.2m" — the follower/post row. */
  private val COUNT = Regex("^\\d[\\d.,]*[kmKM]?$")

  /** Tinder/Bumble/Hinge name line, e.g. "Maya, 26". */
  private val NAME_AGE = Regex("^\\S.*,\\s*\\d{2}$")

  fun classify(s: ScreenSignals): Classification {
    if (s.packageName !in SUPPORTED) return Classification.NOT_PROFILE
    val score = when (s.packageName) {
      INSTAGRAM -> instagram(s)
      TINDER -> tinder(s)
      BUMBLE -> bumble(s)
      HINGE -> hinge(s)
      FACEBOOK -> facebookDating(s)
      else -> 0.0
    }.coerceIn(0.0, 1.0)
    return Classification(score >= THRESHOLD, score)
  }

  private fun List<String>.hasId(vararg fragments: String) =
    any { id -> fragments.any { id.contains(it) } }

  private fun List<String>.hasText(vararg values: String) =
    any { t -> values.any { t == it } }

  private fun instagram(s: ScreenSignals): Double {
    // Veto first — reels, DMs and stories are the expensive false positives, and
    // they can contain profile-ish chrome (avatar, username, follow button).
    if (s.viewIds.hasId("clips_viewer", "reel_viewer", "direct_thread", "story_viewer", "reel_feed")) {
      return 0.0
    }
    var score = 0.0
    if (s.viewIds.hasId("profile_header", "row_profile_header")) score += 0.30
    // The three-count row (posts / followers / following) is the strongest
    // structural tell that survives most redesigns.
    if (s.texts.count { COUNT.matches(it) } >= 3 &&
      s.texts.hasText("followers", "following", "posts")
    ) score += 0.25
    if (s.texts.hasText("follow", "following", "message", "edit profile")) score += 0.20
    if (s.viewIds.hasId("username", "profile_name")) score += 0.15
    if (s.viewIds.hasId("profile_tab", "highlights_tray")) score += 0.10
    return score
  }

  private fun tinder(s: ScreenSignals): Double {
    if (s.viewIds.hasId("chat", "matches_list", "messages")) return 0.0
    var score = 0.0
    if (s.viewIds.hasId("profile_name_age", "user_rec_card", "reccard")) score += 0.35
    if (s.texts.any { NAME_AGE.matches(it) }) score += 0.25
    if (s.texts.hasText("like", "nope", "super like")) score += 0.20
    if (s.viewIds.hasId("profile_bio", "user_profile")) score += 0.15
    return score
  }

  private fun bumble(s: ScreenSignals): Double {
    if (s.viewIds.hasId("chat", "conversation")) return 0.0
    var score = 0.0
    if (s.viewIds.hasId("profile", "encounters")) score += 0.35
    if (s.texts.any { NAME_AGE.matches(it) }) score += 0.25
    if (s.texts.hasText("about me", "my basics", "my interests")) score += 0.25
    return score
  }

  private fun hinge(s: ScreenSignals): Double {
    if (s.viewIds.hasId("chat", "conversation", "match_list")) return 0.0
    var score = 0.0
    if (s.viewIds.hasId("profile", "subject_card")) score += 0.30
    if (s.texts.any { NAME_AGE.matches(it) }) score += 0.20
    // Hinge profiles are prompt-driven; the prompt headings are distinctive.
    if (s.texts.hasText("my simple pleasures", "a shower thought i recently had", "dating me is like")) {
      score += 0.30
    }
    return score
  }

  private fun facebookDating(s: ScreenSignals): Double {
    // Dating lives inside the main Facebook app; ordinary Facebook is NOT in scope.
    if (!s.viewIds.hasId("dating") && !s.texts.hasText("dating")) return 0.0
    if (s.viewIds.hasId("chat", "thread")) return 0.0
    var score = 0.0
    if (s.viewIds.hasId("dating_profile", "dating_card")) score += 0.45
    if (s.texts.any { NAME_AGE.matches(it) }) score += 0.20
    if (s.texts.hasText("like", "pass")) score += 0.15
    return score
  }
}
