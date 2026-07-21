package expo.modules.profilecapture

import android.content.Context

/**
 * The narrow bridge that lets the accessibility service answer "may I generate a
 * reply?" WITHOUT owning the freemium rule.
 *
 * The rule still lives in JS (`useOutOfCredits`, `FREE_ANALYSIS_LIMIT`, `limits.ts`).
 * The service just can't reach it: it runs when the React context may not exist, so
 * it reads a SNAPSHOT that JS pushes down on launch and on every resume —
 * `isPro` + `freeRemaining`. This is a single, explicit contract of two scalars,
 * NOT a parse of Zustand's persisted JSON (blueprint §4.7 option (a), rejected):
 * there is nothing here to drift because JS overwrites it whole every time.
 *
 * The counter-flow is symmetric. When the inline reply succeeds and burns a free
 * credit, native decrements its local `freeRemaining` (so back-to-back taps gate
 * correctly before the next resume) and increments `consumedPending`. JS drains
 * `consumedPending` on resume and folds it into the real `analysisCount`, then
 * pushes a fresh snapshot. JS stays the source of truth; native holds only a cache
 * and a pending delta.
 *
 * Also the one place the Gemini key crosses into native: JS hands it down here
 * (it is already in the JS bundle via EXPO_PUBLIC_GEMINI_API_KEY) rather than the
 * native side reading BuildConfig, so there is exactly one key definition. Same
 * shipping caveat as gemini.ts — this key is extractable from the build; move both
 * behind a proxy before launch.
 */
object ChatEntitlement {

  private const val PREFS = "rizz_chat_entitlement"
  private const val KEY_API = "api_key"
  private const val KEY_PRO = "is_pro"
  private const val KEY_REMAINING = "free_remaining"
  private const val KEY_CONSUMED = "consumed_pending"

  private fun prefs(ctx: Context) =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** JS pushes the whole snapshot. Never touches `consumed_pending`. */
  fun configure(ctx: Context, apiKey: String, isPro: Boolean, freeRemaining: Int) {
    prefs(ctx).edit()
      .putString(KEY_API, apiKey)
      .putBoolean(KEY_PRO, isPro)
      .putInt(KEY_REMAINING, freeRemaining.coerceAtLeast(0))
      .apply()
  }

  fun apiKey(ctx: Context): String = prefs(ctx).getString(KEY_API, "") ?: ""

  /**
   * A live key by the same rule as `isLiveKey` in gemini.ts: long enough and not a
   * stub. Without it the inline path has nothing to call, so the tap should say so
   * rather than silently do nothing.
   */
  fun hasLiveKey(ctx: Context): Boolean {
    val key = apiKey(ctx)
    return key.length >= 30 && !key.lowercase().contains("mock")
  }

  /** Pro, or at least one free credit left in the snapshot. */
  fun canGenerate(ctx: Context): Boolean {
    val p = prefs(ctx)
    return p.getBoolean(KEY_PRO, false) || p.getInt(KEY_REMAINING, 0) > 0
  }

  /**
   * Record a successful, credit-burning generation. Pro burns nothing. Free
   * decrements the local snapshot AND bumps the pending delta for JS to reconcile.
   * Call ONLY after a reply is actually produced — a failed call must never charge.
   */
  fun recordConsumed(ctx: Context) {
    val p = prefs(ctx)
    if (p.getBoolean(KEY_PRO, false)) return
    p.edit()
      .putInt(KEY_REMAINING, (p.getInt(KEY_REMAINING, 0) - 1).coerceAtLeast(0))
      .putInt(KEY_CONSUMED, p.getInt(KEY_CONSUMED, 0) + 1)
      .apply()
  }

  /** JS drains this on resume, folds it into `analysisCount`, and resets it. */
  fun consumePending(ctx: Context): Int {
    val p = prefs(ctx)
    val n = p.getInt(KEY_CONSUMED, 0)
    if (n != 0) p.edit().putInt(KEY_CONSUMED, 0).apply()
    return n
  }
}
