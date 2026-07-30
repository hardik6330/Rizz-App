package expo.modules.profilecapture

import android.content.Context
import android.os.Bundle
import android.util.Log

/**
 * Analytics from inside the accessibility service.
 *
 * This exists because the bubble's whole lifecycle happens in a process where
 * **there is no JS context to call** — the service runs whether or not the RN
 * app is alive, so `bubble_shown` and `bubble_tapped` are unreachable from
 * `services/analytics.ts`. They are also the two most valuable events the
 * product has: they measure whether the core feature is being seen and used.
 *
 * That is the reason the app uses Firebase rather than a JS-only SDK. The
 * native SDK is the same app instance here as it is in JS, so these events land
 * in the same user's funnel instead of an orphaned second identity.
 *
 * Loaded reflectively, exactly like [GeminiChatClient]'s optionality and
 * `analytics.ts` on the JS side: a build without `google-services.json` has no
 * Firebase classes at all, and analytics must never be the reason the
 * accessibility service crashes. A crash here does not fail an analytics call —
 * it kills the user's ability to analyse anything, silently, until they
 * re-enable the service in Settings.
 *
 * NEVER log: message text, scraped `uiText`, view ids, or the package name of
 * the app being viewed. "The user was in Hinge at 11pm" is exactly the kind of
 * inference this product must not build. `kind` (PROFILE / CHAT) is the whole
 * payload, deliberately.
 */
object RizzAnalytics {
  private const val TAG = "RizzAnalytics"

  private var resolved = false
  private var instance: Any? = null
  private var logMethod: java.lang.reflect.Method? = null

  private fun analytics(context: Context): Any? {
    if (!resolved) {
      resolved = true
      try {
        val cls = Class.forName("com.google.firebase.analytics.FirebaseAnalytics")
        instance = cls.getMethod("getInstance", Context::class.java)
          .invoke(null, context.applicationContext)
        logMethod = cls.getMethod("logEvent", String::class.java, Bundle::class.java)
      } catch (t: Throwable) {
        // No Firebase in this build. Expected, and not worth a warning every call.
        Log.i(TAG, "Firebase Analytics unavailable — events disabled")
        instance = null
      }
    }
    return instance
  }

  private fun log(context: Context, name: String, params: Bundle) {
    val target = analytics(context) ?: return
    try {
      logMethod?.invoke(target, name, params)
    } catch (t: Throwable) {
      Log.w(TAG, "logEvent failed: $name", t)
    }
  }

  /** The bubble became visible on a screen we classified. */
  fun bubbleShown(context: Context, kind: ScreenKind) {
    log(context, "bubble_shown", Bundle().apply { putString("kind", kind.name.lowercase()) })
  }

  /** The user tapped it — the single most important conversion in the product. */
  fun bubbleTapped(context: Context, kind: ScreenKind) {
    log(context, "bubble_tapped", Bundle().apply { putString("kind", kind.name.lowercase()) })
  }

  /**
   * Dragged onto ✕. Mirrors `a11y_disabled` from the JS toggle so the two ways of
   * turning the feature off show up in one funnel — this one signals annoyance
   * with the bubble specifically, which the in-app switch does not.
   */
  fun bubbleDismissed(context: Context) {
    log(context, "a11y_disabled", Bundle().apply { putString("via", "bubble_drag") })
  }

  /** The service actually bound — the true bottom of the accessibility funnel. */
  fun serviceConnected(context: Context) {
    log(context, "a11y_service_connected", Bundle())
  }
}
