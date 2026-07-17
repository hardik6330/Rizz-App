package expo.modules.profilecapture

/**
 * The one hand-off point between the accessibility service and JS.
 *
 * The service runs when the React context does not exist, so it CANNOT ask JS
 * whether the user still has free credits (`useOutOfCredits`) or is Pro — that
 * state lives in Zustand/MMKV on the JS side. Rather than reimplement the
 * freemium rule in Kotlin (which is how the limits.ts bug happens again, in two
 * languages, with no self-check), the native side stashes the capture here and
 * launches the app. JS pulls it on resume and applies the rules it already owns.
 *
 * So: native answers "what screen is this" and "here are the pixels", nothing more.
 * That is also what keeps v2 (chat analysis) cheap — it reuses this seam with a
 * different ScreenKind.
 *
 * Holds ONE capture, in memory only. Never written to disk: no temp file means no
 * file to leak and none to forget to delete. Overwritten by the next capture and
 * cleared as soon as JS consumes it.
 */
object CaptureStore {

  data class Capture(
    /** JPEG bytes, base64 — handed straight to the Gemini vision call. */
    val base64: String,
    /** Package name of the app it came from. */
    val app: String,
    /** Text scraped from the tree; a HINT for the model, never the primary input. */
    val uiText: String,
    val confidence: Double,
  )

  @Volatile
  private var pending: Capture? = null

  fun put(capture: Capture) {
    pending = capture
  }

  /** Take the pending capture, clearing it. Returns null when there is none. */
  @Synchronized
  fun consume(): Capture? {
    val c = pending
    pending = null
    return c
  }

  @Synchronized
  fun clear() {
    pending = null
  }
}
