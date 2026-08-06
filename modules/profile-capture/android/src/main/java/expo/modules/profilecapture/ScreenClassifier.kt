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

  const val WHATSAPP = "com.whatsapp"
  const val SNAPCHAT = "com.snapchat.android"
  const val TELEGRAM = "org.telegram.messenger"

  /** Apps with a profile surface worth scoring. Only these can produce PROFILE. */
  val DATING = setOf(INSTAGRAM, TINDER, BUMBLE, HINGE, FACEBOOK)

  /**
   * Chat-only apps: general messengers with no dating profile to score, added so the
   * reply bubble reaches the threads people actually use.
   *
   * They can ONLY ever resolve to CHAT — `classify` scores them 0.0 for profile, so
   * there is no path to a screenshot capture here. That is deliberate and is what
   * keeps the Play-review story the same as before: we read a conversation you
   * explicitly tapped ✨ on, and nothing else.
   */
  val MESSENGERS = setOf(WHATSAPP, SNAPCHAT, TELEGRAM)

  val SUPPORTED = DATING + MESSENGERS

  /** A count like "1,234" / "12.3K" / "1.2m" — the follower/post row. */
  private val COUNT = Regex("^\\d[\\d.,]*[kmKM]?$")

  /**
   * The same row when the app renders count and label in ONE node: "1,234 posts",
   * or "1,234\nposts".
   *
   * Instagram does exactly this, and it broke the strongest structural signal the
   * classifier had. `COUNT.matches("1,234\nposts")` is false and
   * `hasText("posts")` is exact-equality, so a modern profile scored 0 for the
   * three-count row — leaving a private account (no visible grid) at exactly 0.75,
   * on the threshold, one id drift away from the bubble silently never appearing.
   */
  private val COUNT_LABEL = Regex(
    "^\\d[\\d.,]*[kmKM]?\\s+(posts?|followers?|following)$",
    RegexOption.IGNORE_CASE,
  )

  /** Tinder/Bumble/Hinge name line, e.g. "Maya, 26". */
  private val NAME_AGE = Regex("^\\S.*,\\s*\\d{2}$")

  /**
   * Controls only present on your OWN profile. "Edit profile" is the reliable one
   * across Instagram and Facebook; a dating app never shows another user's profile
   * with an edit control either.
   */
  private val OWN_PROFILE_MARKERS = listOf("edit profile", "share profile", "edit_profile")

  /**
   * Per-app view ids that only appear on the user's OWN profile.
   *
   * The text markers above are English and exact-match, so a German user's own
   * profile read as somebody else's — and the two want opposite reports. The model
   * is then asked to write openers *about the user themselves*, which it correctly
   * refuses to do, and the app looks broken. View ids are not localised, so these
   * carry the detection everywhere the copy does not.
   *
   * Instagram was already covered by `edit_profile`; the dating apps had nothing
   * at all, so their own-profile tab always classified as 'them'.
   */
  private val OWN_PROFILE_IDS = mapOf(
    INSTAGRAM to arrayOf("edit_profile", "profile_action_bar", "self_profile"),
    TINDER to arrayOf("my_profile", "profile_tab", "edit_profile"),
    BUMBLE to arrayOf("my_profile", "profile_edit", "own_profile"),
    HINGE to arrayOf("self_profile", "my_profile", "profile_edit"),
    FACEBOOK to arrayOf("dating_self_profile", "edit_dating_profile"),
  )

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

  /**
   * Screens that are NEVER an open conversation, whatever else they score.
   *
   * Every profile scorer below opens with a veto; `chatScore` had none, and that
   * asymmetry was a real hole. A story is vetoed as a profile and then scored as a
   * chat: its reply box is editable (+0.35), its placeholder says "Send message"
   * (+0.15) and Instagram's story composer id contains `message_composer` (+0.50)
   * — a full 1.0, so the bubble appeared over exactly the screen the veto list
   * exists to keep it off. The DM INBOX did the same thing: an id containing
   * "messages" plus the inbox search field cleared the threshold, putting the
   * bubble over a list of other people's conversation previews.
   *
   * A list of chats is not a chat. A story is not a chat.
   */
  private val CHAT_VETO_IDS = arrayOf(
    "clips_viewer", "reel_viewer", "reel_feed", "story_viewer", "stories_tray",
    "inbox", "thread_list", "matches_list", "match_list",
  )

  /**
   * Composer placeholders in the general messengers. These carry the load there,
   * because a messenger's inbox ALSO has an editable field (the search bar) — so
   * "editable field present" alone would put the bubble over a list of previews.
   * A composer says "message"/"send a chat"; a search bar says "search".
   *
   * Like every selector in this file these are unversioned and localised — an
   * app in another language degrades to no bubble, never to a wrong one.
   */
  private val MESSENGER_COMPOSER_HINTS = listOf(
    "message", "type a message", "send a message", "send a chat", "write a message",
  )

  /** A composer placeholder is a couple of words; an inbox preview is a sentence. */
  private const val MAX_PLACEHOLDER_LEN = 24

  /**
   * Per-app id fragments for the messengers, checked as an alternative to the
   * placeholder (which disappears once the user starts typing).
   *
   * WhatsApp's are the confident ones — `conversation_*` and the `entry` composer
   * have been stable for years. Telegram draws its thread on a canvas and Snapchat
   * obfuscates, so both lean on the placeholder instead; if the bubble never shows
   * there, dump `viewIds` from a real device before guessing again.
   */
  private val MESSENGER_ID_MARKERS = mapOf(
    WHATSAPP to arrayOf("conversation", "entry", "conversation_contact_name"),
    TELEGRAM to arrayOf("chat_", "messages_list", "message_edit_text"),
    SNAPCHAT to arrayOf("chat_input", "chat_message", "conversation"),
  )

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
      // MESSENGERS land here: no dating profile surface, so no PROFILE path and no
      // screenshot capture — a general messenger can only ever offer a reply.
      else -> 0.0
    }.coerceIn(0.0, 1.0)

    if (chat >= CHAT_THRESHOLD && chat >= profile) {
      return Classification(false, chat, kind = ScreenKind.CHAT)
    }

    val own = s.texts.any { t -> OWN_PROFILE_MARKERS.any { t == it } } ||
      s.viewIds.any { id -> OWN_PROFILE_MARKERS.any { id.contains(it) } } ||
      // Not localised, unlike the copy above — see OWN_PROFILE_IDS.
      (OWN_PROFILE_IDS[s.packageName]?.let { s.viewIds.hasId(*it) } ?: false)
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
    // Veto first, exactly like every profile scorer. See CHAT_VETO_IDS.
    if (s.viewIds.hasId(*CHAT_VETO_IDS)) return 0.0
    if (s.packageName == FACEBOOK && !s.viewIds.hasId("dating") && !s.texts.hasText("dating")) {
      return 0.0
    }
    if (s.packageName in MESSENGERS) return messengerChatScore(s)
    var score = 0.0
    if (s.viewIds.hasId(*CHAT_ID_MARKERS)) score += 0.50
    // Stands in for "the keyboard is right here" — the moment a reply is useful.
    if (s.hasEditable) score += 0.35
    /*
     * Length-bounded, the same way messengerChatScore already bounds its own.
     *
     * This was a bare `contains("message")`, which matches "Send message",
     * "3 new messages", "Message requests" and any inbox preview containing the
     * word — so it fired on half of Instagram. A composer placeholder is a couple
     * of words; anything longer is prose about messages, not a place to type one.
     */
    if (s.texts.any { t ->
        t.length <= MAX_PLACEHOLDER_LEN && CHAT_TEXT_HINTS.any { t == it || t.startsWith(it) }
      }) score += 0.15
    return score
  }

  /**
   * Chat scoring for the general messengers, where the *app* already tells us the
   * surface is conversations. The only question left is the one that matters:
   * is this an OPEN thread, or the inbox list?
   *
   * A composer is necessary but not sufficient — a messenger inbox has a search
   * field, which is also editable. So it takes the composer PLUS one confirm that
   * this is a thread: the composer placeholder, or an app-specific thread id.
   * Deliberately all-or-nothing rather than additive: partial evidence in a
   * messenger means "not sure", and not-sure must mean no bubble.
   */
  private fun messengerChatScore(s: ScreenSignals): Double {
    if (!s.hasEditable) return 0.0
    // Length-bounded: a composer placeholder is a couple of words ("Message…",
    // "Send a chat"), whereas an inbox row's preview can also start with "message"
    // and would otherwise put the bubble over the conversation list.
    val placeholder = s.texts.any { t ->
      t.length <= MAX_PLACEHOLDER_LEN && MESSENGER_COMPOSER_HINTS.any { t == it || t.startsWith(it) }
    }
    val threadId = MESSENGER_ID_MARKERS[s.packageName]
      ?.let { s.viewIds.hasId(*it) } ?: false
    return if (placeholder || threadId) 0.85 else 0.0
  }

  /**
   * Is the posts/followers/following row on screen, in either rendering?
   *
   * Newlines are collapsed first: `collect()` trims each node but keeps the
   * internal newline in "1,234\nposts", which is how the composite form arrives.
   */
  private fun countRow(texts: List<String>): Boolean {
    val bare = texts.count { COUNT.matches(it) } >= 3 &&
      texts.hasText("followers", "following", "posts")
    val composite = texts.count { COUNT_LABEL.matches(it.replace('\n', ' ').trim()) } >= 2
    return bare || composite
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
    // structural tell that survives most redesigns. Accepted in either shape —
    // three bare numbers beside their labels, or two composite "1,234 posts"
    // nodes. Two, not three, because a private account hides the post count.
    if (countRow(s.texts)) score += 0.25
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
    /*
     * Structure, not prompt copy.
     *
     * This used to award 0.30 for three hardcoded English prompt headings ("my
     * simple pleasures", …). Hinge rotates its prompt library continuously and
     * localises it, so that bonus decayed to zero over weeks and vanished
     * instantly outside en-US — leaving a real Hinge profile at 0.50, below the
     * 0.75 threshold, with the bubble simply never appearing. What does not rotate
     * is the shape of the screen: every prompt card carries a like/comment
     * control, and the vitals row is always there.
     */
    if (s.viewIds.hasId("prompt", "like_button", "vitals", "basics")) score += 0.25
    if (s.texts.hasText("send like", "add a comment")) score += 0.10
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
