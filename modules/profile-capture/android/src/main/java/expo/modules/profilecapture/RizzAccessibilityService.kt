package expo.modules.profilecapture

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream

/**
 * Detects profile screens in the supported apps and offers the analyze bubble.
 *
 * Owns detection and capture ONLY. It never decides whether the user has credits
 * — that rule lives in JS (`useOutOfCredits`) and duplicating it here is how the
 * limits.ts bug happens again in two languages. On tap it captures, stashes to
 * CaptureStore and launches the app; JS applies the rules it already owns.
 *
 * Capture NEVER happens without a tap. No pre-emptive capture, no buffer, no
 * capture-on-detect. The tap is the consent event; anything else is spyware in
 * behaviour regardless of intent.
 */
class RizzAccessibilityService : AccessibilityService() {

  private val main = Handler(Looper.getMainLooper())
  private var overlay: OverlayController? = null
  private var lastSignature: String? = null
  private var lastClassifiedAt = 0L
  private var capturing = false

  override fun onServiceConnected() {
    super.onServiceConnected()
    overlay = OverlayController(this)
    RUNNING = true
    Log.i(TAG, "service connected")
  }

  override fun onDestroy() {
    RUNNING = false
    main.post { overlay?.hide() }
    overlay = null
    super.onDestroy()
  }

  override fun onInterrupt() {
    main.post { overlay?.hide() }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || !ENABLED) return
    val pkg = event.packageName?.toString() ?: return

    // Cheapest possible bail-out. packageNames in the service config already
    // filters, but a user switching apps still lands here — leaving fast is what
    // keeps this off the battery budget.
    if (pkg !in ScreenClassifier.SUPPORTED) {
      hideBubble()
      return
    }

    when (event.eventType) {
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
      AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> Unit
      else -> return
    }

    // Debounce: content-changed fires continuously while a feed scrolls.
    val now = System.currentTimeMillis()
    if (now - lastClassifiedAt < DEBOUNCE_MS) return
    lastClassifiedAt = now

    val root = rootInActiveWindow ?: return
    val signals = try {
      collect(root, pkg)
    } catch (e: Exception) {
      Log.w(TAG, "tree walk failed", e)
      return
    }

    val result = ScreenClassifier.classify(signals)
    if (result.isProfile) showBubble(pkg, signals, result.confidence) else hideBubble()
  }

  // -------------------------------------------------------------------------
  // Tree → signals
  // -------------------------------------------------------------------------

  /**
   * Flattens the visible tree into ids + text.
   *
   * Bounded by MAX_NODES and MAX_DEPTH: Instagram's feed can be enormous and this
   * runs on the main thread on every debounced event. A partial read that is fast
   * beats a complete read that janks the host app — detection only needs a handful
   * of signals, not the whole tree.
   */
  private fun collect(root: AccessibilityNodeInfo, pkg: String): ScreenSignals {
    val ids = ArrayList<String>(64)
    val texts = ArrayList<String>(64)
    var visited = 0

    fun walk(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || visited >= MAX_NODES || depth > MAX_DEPTH) return
      visited++
      node.viewIdResourceName?.let { ids.add(it.lowercase()) }
      node.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { texts.add(it.lowercase()) }
      node.contentDescription?.toString()?.trim()?.takeIf { it.isNotEmpty() }
        ?.let { texts.add(it.lowercase()) }
      for (i in 0 until node.childCount) walk(node.getChild(i), depth + 1)
    }

    walk(root, 0)
    return ScreenSignals(packageName = pkg, viewIds = ids, texts = texts)
  }

  // -------------------------------------------------------------------------
  // Bubble
  // -------------------------------------------------------------------------

  private fun showBubble(pkg: String, signals: ScreenSignals, confidence: Double) {
    // Don't re-add on every content-changed for the same screen — it would restart
    // the entry animation and make the bubble flicker while scrolling a profile.
    val signature = pkg + "|" + signals.viewIds.take(6).joinToString(",")
    if (overlay?.isShowing == true && signature == lastSignature) return
    lastSignature = signature
    main.post {
      overlay?.show { onAnalyzeTapped(pkg, signals, confidence) }
    }
  }

  private fun hideBubble() {
    if (overlay?.isShowing != true) return
    lastSignature = null
    main.post { overlay?.hide() }
  }

  // -------------------------------------------------------------------------
  // Capture — only ever from a tap
  // -------------------------------------------------------------------------

  private fun onAnalyzeTapped(pkg: String, signals: ScreenSignals, confidence: Double) {
    if (capturing) return
    capturing = true
    Log.i(TAG, "analyze tapped ($pkg, confidence=$confidence)")

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      // takeScreenshot() is API 30+. Below that the only route is MediaProjection,
      // which we deliberately do not ship — see the blueprint §4.5.
      Log.w(TAG, "takeScreenshot unavailable below API 30")
      main.post { overlay?.hide() }
      capturing = false
      return
    }

    lastSignature = null
    main.post { overlay?.playScan() }

    /*
     * Capture on a plain Handler timeline, NOT from the animation's end-callback.
     * The callback is not guaranteed: an incoming event can hide the bubble
     * mid-animation, the view detaches, the callback is dropped, capture never
     * runs — and `capturing` stays true, so every later tap is ignored too. The
     * animation is feedback; it must never be load-bearing.
     *
     * The bubble must still be gone before the shot or it lands in the screenshot,
     * hence hide() first and a frame's grace before capturing.
     */
    main.postDelayed({
      overlay?.hide()
      main.postDelayed({ capture(pkg, signals, confidence) }, 60)
    }, OverlayController.SCAN_MS)

    // Watchdog: whatever goes wrong downstream, never leave the button wedged.
    main.postDelayed({
      if (capturing) {
        Log.w(TAG, "capture watchdog fired — resetting")
        capturing = false
      }
    }, 6000)
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun capture(pkg: String, signals: ScreenSignals, confidence: Double) {
    takeScreenshot(
      android.view.Display.DEFAULT_DISPLAY,
      { r -> r.run() },
      // Qualified: Kotlin does not bring a superclass's nested types into scope.
      object : AccessibilityService.TakeScreenshotCallback {
        override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
          try {
            val buffer = screenshot.hardwareBuffer
            val bitmap = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
            buffer.close()
            if (bitmap == null) {
              Log.w(TAG, "wrapHardwareBuffer returned null")
              capturing = false
              return
            }
            val base64 = encode(bitmap)
            bitmap.recycle()
            CaptureStore.put(
              CaptureStore.Capture(
                base64 = base64,
                app = pkg,
                uiText = signals.texts.distinct().take(60).joinToString("\n"),
                confidence = confidence,
              )
            )
            Log.i(TAG, "captured ${base64.length} b64 chars — launching app")
            launchApp()
          } catch (e: Exception) {
            Log.w(TAG, "capture failed", e)
          } finally {
            capturing = false
          }
        }

        override fun onFailure(errorCode: Int) {
          // Framework throttles takeScreenshot (~1/s) and can fail transiently.
          // No retry loop: a silent retry storm is worse than a missed tap.
          Log.w(TAG, "takeScreenshot failed: $errorCode")
          capturing = false
        }
      },
    )
  }

  /**
   * Downscale + JPEG. Never touches disk — bitmap → bytes → base64 → memory, so
   * there is no temp file to leak and none to forget to delete.
   */
  private fun encode(bitmap: Bitmap): String {
    val longest = maxOf(bitmap.width, bitmap.height)
    val scaled = if (longest > MAX_EDGE) {
      val ratio = MAX_EDGE.toFloat() / longest
      Bitmap.createScaledBitmap(
        bitmap, (bitmap.width * ratio).toInt(), (bitmap.height * ratio).toInt(), true
      )
    } else bitmap

    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
    if (scaled !== bitmap) scaled.recycle()
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }

  private fun launchApp() {
    val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(EXTRA_FROM_CAPTURE, true)
    }
    if (intent == null) {
      Log.w(TAG, "no launch intent")
      return
    }
    startActivity(intent)
  }

  companion object {
    private const val TAG = "RizzA11y"
    private const val DEBOUNCE_MS = 400L
    private const val MAX_NODES = 400
    private const val MAX_DEPTH = 25
    private const val MAX_EDGE = 1280
    private const val JPEG_QUALITY = 80
    const val EXTRA_FROM_CAPTURE = "rizz_from_capture"

    /** True while the system has the service bound. */
    @Volatile
    var RUNNING = false
      private set

    /**
     * User-facing kill switch, flipped from JS. Enabling the service in Settings is
     * necessary but not sufficient — the user must also turn the feature on in the
     * app, so "enabled in Settings" never silently means "watching my screen".
     */
    @Volatile
    var ENABLED = false
  }
}
