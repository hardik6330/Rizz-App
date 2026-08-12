package expo.modules.profilecapture

import android.content.Context

/**
 * The narrow bridge that lets the accessibility service answer "may I generate a
 * reply?" and "who am I?" WITHOUT owning the freemium rule.
 *
 * The rule lives on the server now (`backend/src/middleware/credits.ts`). The
 * service still keeps a local snapshot because it must gate a tap instantly and
 * offline — but the snapshot is a CACHE, refreshed from the server's response on
 * every generation, not a second implementation.
 *
 * JS pushes the snapshot down on launch and every resume: the API base URL, the
 * anonymous install id, `isPro` and `freeRemaining`. A single explicit contract,
 * NOT a parse of Zustand's persisted JSON (blueprint §4.7 option (a), rejected):
 * there is nothing here to drift because JS overwrites it whole every time.
 *
 * **This used to hold the Gemini API key.** It no longer does, and nothing here
 * can call Google. The install id is stored instead: it never expires, so the
 * bubble can authenticate itself days after the app was last opened, which a 24h
 * access token could not. The token it mints is cached beside it and is the only
 * short-lived value in this file.
 */
object ChatEntitlement {

  private const val PREFS = "rizz_chat_entitlement"
  private const val KEY_API_URL = "api_url"
  private const val KEY_INSTALL = "install_id"
  private const val KEY_TOKEN = "access_token"
  private const val KEY_PRO = "is_pro"
  private const val KEY_REMAINING = "free_remaining"
  private const val KEY_CONSUMED = "consumed_pending"

  private fun prefs(ctx: Context) =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** JS pushes the whole snapshot. Never touches the token or `consumed_pending`. */
  fun configure(ctx: Context, apiUrl: String, installId: String, isPro: Boolean, freeRemaining: Int) {
    prefs(ctx).edit()
      .putString(KEY_API_URL, apiUrl.trimEnd('/'))
      .putString(KEY_INSTALL, installId)
      .putBoolean(KEY_PRO, isPro)
      .putInt(KEY_REMAINING, freeRemaining.coerceAtLeast(0))
      .apply()
  }

  fun apiUrl(ctx: Context): String = prefs(ctx).getString(KEY_API_URL, "") ?: ""

  fun installId(ctx: Context): String = prefs(ctx).getString(KEY_INSTALL, "") ?: ""

  fun accessToken(ctx: Context): String = prefs(ctx).getString(KEY_TOKEN, "") ?: ""

  fun setAccessToken(ctx: Context, token: String) {
    prefs(ctx).edit().putString(KEY_TOKEN, token).apply()
  }

  /**
   * Remember the install id `/v1/auth/device` minted for us.
   *
   * **Every anonymous `users` row this app has ever leaked came from not doing
   * this.** `GeminiChatClient.authenticate` omits `install_id` when it has none,
   * the server answers by minting a fresh UUID *and a fresh row to hang it on*,
   * and the reply was being read for `access_token` only — so the id was thrown
   * away and the very next re-auth asked for another one. One dead row per
   * authentication, for ever, with no email and no username to tell them apart.
   *
   * JS does the same thing in `persistSession`; this is the half of that contract
   * the Kotlin port dropped. Written only when the server actually echoed one, so
   * a response without the field can never blank an id we already hold.
   */
  fun setInstallId(ctx: Context, installId: String) {
    if (installId.isBlank()) return
    prefs(ctx).edit().putString(KEY_INSTALL, installId).apply()
  }

  /**
   * Is there an API to call? Replaces the old `hasLiveKey`.
   *
   * Without a configured URL the inline path has nothing to talk to, so the tap
   * should say so rather than silently do nothing.
   */
  fun hasApi(ctx: Context): Boolean = apiUrl(ctx).startsWith("http")

  /** Pro, or at least one free credit left in the snapshot. */
  fun canGenerate(ctx: Context): Boolean {
    val p = prefs(ctx)
    return p.getBoolean(KEY_PRO, false) || p.getInt(KEY_REMAINING, 0) > 0
  }

  /**
   * Take the server's balance verbatim after a successful generation.
   *
   * This replaced a local `recordConsumed()` that decremented its own counter and
   * queued a delta for JS to fold in. With the server charging the credit, that
   * would have counted the same generation twice — once natively and once again
   * when JS reconciled. The server is the only thing that decides a balance now;
   * this just mirrors it so the next tap gates correctly without a round trip.
   */
  fun applyServerCredits(ctx: Context, isPro: Boolean, remaining: Int) {
    prefs(ctx).edit()
      .putBoolean(KEY_PRO, isPro)
      .putInt(KEY_REMAINING, if (isPro) 9999 else remaining.coerceAtLeast(0))
      .apply()
  }

  /**
   * Retained so JS's existing resume hook keeps compiling and stays correct.
   *
   * Always 0 now — the server owns the count, so there is no local delta to fold
   * in. Kept rather than deleted because removing it would mean touching the JS
   * resume path for no behavioural gain, and a future offline queue would refill it.
   */
  fun consumePending(ctx: Context): Int {
    val p = prefs(ctx)
    val n = p.getInt(KEY_CONSUMED, 0)
    if (n != 0) p.edit().putInt(KEY_CONSUMED, 0).apply()
    return n
  }
}
