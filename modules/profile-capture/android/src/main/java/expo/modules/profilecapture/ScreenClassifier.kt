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

/**
 * What the user is looking at. The MVP only needs the coarse kind — the bubble's
 * action, not a taxonomy, hangs off this.
 *
 * - PROFILE — a dating/social profile → screenshot → report ('self'/'them').
 * - CHAT — an open conversation with a compose field → read the thread → suggest a
 *   reply and copy it to the clipboard. This is the "v2" the CaptureStore seam was
 *   built for; see docs/profile-analyzer-blueprint.md §8.
 * - NONE — anything else. Bias hard toward NONE: a bubble over the wrong screen is
 *   a privacy incident even though nothing is captured without a tap.
 */
enum class ScreenKind { NONE, PROFILE, CHAT }

/** Flattened, app-agnostic view of the accessibility tree. */
data class ScreenSignals(
  val packageName: String,
  /** Lowercased `getViewIdResourceName()` values present on screen. */
  val viewIds: List<String> = emptyList(),
  /** Lowercased text + contentDescription values present on screen. */
  val texts: List<String> = emptyList(),
  /**
   * An editable field (message composer) is present. The single strongest tell that
   * a screen is an open chat rather than a profile — a profile never carries one,
   * and it stands in for "the keyboard is a tap away", which is when a reply is
   * actually useful.
   */
  val hasEditable: Boolean = false,
)

data class Classification(
  val isProfile: Boolean,
  val confidence: Double,
  /**
   * The user is looking at their OWN profile, not someone else's.
   *
   * The bubble appears on any profile, including the user's own, and the two cases
   * want opposite reports: coach my profile ('self') vs write me openers ('them').
   * Without this the app would reject the user's own profile as "not someone you
   * can message", which is technically correct and useless.
   */
  val isOwnProfile: Boolean = false,
  /** Coarse screen kind that selects the bubble's action. */
  val kind: ScreenKind = ScreenKind.NONE,
) {
  companion object {
    val NOT_PROFILE = Classification(false, 0.0, kind = ScreenKind.NONE)
  }
}

object ScreenClassifier {

  /** Fire the profile bubble at or above this score. High on purpose. */
  const val THRESHOLD = 0.75

  /**
   * Fire the chat bubble at or above this score. A chat id alone (0.5) is not
   * enough — it takes the compose field too, so a matches list or a conversation
   * preview in an inbox never trips it. Only a screen you can actually reply on.
   */
  const val CHAT_THRESHOLD = 0.75

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

  /**
   * Controls only present on your OWN profile. "Edit profile" is the reliable one
   * across Instagram and Facebook; a dating app never shows another user's profile
   * with an edit control either.
   */
  private val OWN_PROFILE_MARKERS = listOf("edit profile", "share profile", "edit_profile")

  /**
   * View-id fragments that name a conversation surface across the supported apps.
   * These are the same fragments the profile scorers veto on — here they are the
   * positive signal instead. Unversioned private ids; expect drift, see §4.2.
   */
  private val CHAT_ID_MARKERS = arrayOf(
    "chat", "conversation", "direct_thread", "thread", "message_composer", "messages", "messenger",
  )

  /** Composer placeholder text, a soft confirm on top of the id + editable field. */
  private val CHAT_TEXT_HINTS = listOf("message", "type a message", "send a message")

  fun classify(s: ScreenSignals): Classification {
    if (s.packageName !in SUPPORTED) return Classification.NOT_PROFILE

    // Chat is checked first and wins ties. The profile scorers already veto on chat
    // ids (a DM must never read as a profile), so a real chat scores ~0 there anyway
    // — but resolving to CHAT explicitly is what turns those vetoed screens from
    // "nothing" into "offer a reply", without ever letting one read as a profile.
    val chat = chatScore(s).coerceIn(0.0, 1.0)
    val profile = when (s.packageName) {
      INSTAGRAM -> instagram(s)
      TINDER -> tinder(s)
      BUMBLE -> bumble(s)
      HINGE -> hinge(s)
      FACEBOOK -> facebookDating(s)
      else -> 0.0
    }.coerceIn(0.0, 1.0)

    if (chat >= CHAT_THRESHOLD && chat >= profile) {
      return Classification(false, chat, kind = ScreenKind.CHAT)
    }

    val own = s.texts.any { t -> OWN_PROFILE_MARKERS.any { t == it } } ||
      s.viewIds.any { id -> OWN_PROFILE_MARKERS.any { id.contains(it) } }
    val isProfile = profile >= THRESHOLD
    return Classification(
      isProfile,
      profile,
      isOwnProfile = own,
      kind = if (isProfile) ScreenKind.PROFILE else ScreenKind.NONE,
    )
  }

  /**
   * "Is this an open conversation I could reply in?" — app-agnostic on purpose.
   *
   * A chat id names the surface; the compose field confirms it is the open thread
   * and not an inbox list of previews. Both are needed to clear CHAT_THRESHOLD, so
   * a matches/inbox screen (id present, no composer) stays silent. Facebook is
   * gated to Dating only, exactly like the profile path — plain Messenger is out
   * of scope.
   */
  private fun chatScore(s: ScreenSignals): Double {
    if (s.packageName == FACEBOOK && !s.viewIds.hasId("dating") && !s.texts.hasText("dating")) {
      return 0.0
    }
    var score = 0.0
    if (s.viewIds.hasId(*CHAT_ID_MARKERS)) score += 0.50
    // Stands in for "the keyboard is right here" — the moment a reply is useful.
    if (s.hasEditable) score += 0.35
    if (s.texts.any { t -> CHAT_TEXT_HINTS.any { t.startsWith(it) || t.contains(it) } }) score += 0.15
    return score
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
