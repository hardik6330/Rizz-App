package expo.modules.profilecapture

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.util.Base64
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

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
  private var lastOverlayWarnAt = 0L

  /**
   * Guards against a second tap while a capture is in flight. MUST be @Volatile:
   * it is set true on the main thread (onAnalyzeTapped) but reset false from the
   * takeScreenshot callback, which the framework runs on a BINDER thread. Without
   * the barrier the main thread never sees the reset, so `if (capturing) return`
   * swallows every tap after the first capture until the watchdog resets it on the
   * main thread ~6s later — the "the button dies until I wait" bug.
   */
  @Volatile
  private var capturing = false

  /** One background thread for the inline Gemini call — off the main thread. */
  private val chatExecutor = Executors.newSingleThreadExecutor()

  override fun onServiceConnected() {
    super.onServiceConnected()
    overlay = OverlayController(this).apply {
      /**
       * Dragging the bubble onto ✕ is the user saying "stop showing me this" — so
       * it flips the same kill switch the in-app toggle owns, rather than hiding
       * the bubble for one screen and having it reappear on the next profile.
       *
       * Persisted, so the app's switch reads OFF the next time it refreshes
       * (analyzer.tsx re-reads on resume, profile.tsx on focus) and so the choice
       * survives the process being killed. Turning it back on is a deliberate act
       * in the app — which is the same rule as the first grant: enabled in
       * Settings must never by itself mean "watching my screen".
       */
      onCloseListener = {
        RizzAnalytics.bubbleDismissed(this@RizzAccessibilityService)
        setEnabledPersisted(this@RizzAccessibilityService, false)
        CaptureStore.clear()
        lastSignature = null
        toast(getString(R.string.rizz_bubble_disabled))
      }
      /*
       * Overlay refused. Tell the user once, then stop trying.
       *
       * Throttled because the refusal repeats on every classified event — without
       * the guard, revoking the permission would fire a toast every 400ms over
       * whatever app they are using. `isWatching()` already reports false to the
       * app's own UI in this state; this is the in-context half, for the user who
       * is looking at Instagram wondering where the bubble went.
       */
      onShowFailed = {
        val now = System.currentTimeMillis()
        if (now - lastOverlayWarnAt > OVERLAY_WARN_INTERVAL_MS) {
          lastOverlayWarnAt = now
          toast(getString(R.string.rizz_overlay_denied))
        }
      }
    }
    // Restore the kill switch across process death. When the user swipes the app
    // out of recents, this whole process (and the static ENABLED) dies; the system
    // rebinds the service in a fresh process with no JS to turn it back on. Without
    // this the bubble silently never returns until the app is opened again.
    ENABLED = loadEnabled(this)
    RUNNING = true
    RizzAnalytics.serviceConnected(this)
    Log.i(TAG, "service connected (enabled=$ENABLED)")

    /*
     * Re-evaluate the CURRENT window, rather than waiting for an event.
     *
     * This is the fix for "the bubble disappears when I close the app". Swiping
     * RizzCoach out of recents kills this process — the service lives in it — and
     * the system rebinds us in a fresh one. ENABLED is restored above, but the
     * bubble was only ever created from an accessibility event, and a user sitting
     * still on a profile generates none: the window has not changed, so no
     * WINDOW_STATE_CHANGED, and the content is static, so no CONTENT_CHANGED. The
     * bubble stayed gone until they happened to scroll.
     *
     * Delayed because rootInActiveWindow is routinely null for the first few
     * hundred milliseconds after a bind — asking immediately just returns nothing.
     */
    main.postDelayed({ reclassifyCurrentWindow("connect") }, RECONNECT_SETTLE_MS)

    /*
     * The other moment we are looking at a screen we were never told about: the
     * user unlocks the phone onto whatever was last open. No event fires for a
     * window that was already there.
     */
    runCatching {
      val filter = IntentFilter().apply {
        addAction(Intent.ACTION_USER_PRESENT)
        addAction(Intent.ACTION_SCREEN_OFF)
      }
      // Both are protected system broadcasts, so API 34's export rule technically
      // exempts them — but the exemption is easy to lose track of and a
      // SecurityException here would take the whole service down. Be explicit.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        registerReceiver(screenReceiver, filter)
      }
    }.onFailure { Log.w(TAG, "receiver register failed", it) }
  }

  /**
   * Unlock → re-check the current screen. Screen off → drop the bubble, so it is
   * never sitting on the lock screen waiting to be tapped by someone else.
   */
  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        Intent.ACTION_USER_PRESENT -> reclassifyCurrentWindow("unlock")
        Intent.ACTION_SCREEN_OFF -> hideBubble()
      }
    }
  }

  override fun onDestroy() {
    RUNNING = false
    /*
     * Synchronous, and BEFORE the field is cleared.
     *
     * This used to be `main.post { overlay?.hide() }` followed immediately by
     * `overlay = null`. onDestroy already runs on the main thread, so the post was
     * scheduled for after the current message — by which time the field was null
     * and `?.hide()` was a no-op. removeView() was never called, so a service
     * stopped without the process dying (the user switching it off in Settings)
     * left an orphan bubble on screen wired to a destroyed service.
     */
    overlay?.hide()
    overlay = null
    runCatching { unregisterReceiver(screenReceiver) }
    chatExecutor.shutdownNow()
    super.onDestroy()
  }

  /**
   * The body of [onAccessibilityEvent] without the event — for the moments we have
   * to ask rather than be told. Safe to call from any of them; it is the same
   * decision, made against `rootInActiveWindow` instead of an event.
   */
  private fun reclassifyCurrentWindow(reason: String) {
    if (!ENABLED) return
    val root = rootInActiveWindow ?: return
    val pkg = root.packageName?.toString() ?: return
    if (pkg !in ScreenClassifier.SUPPORTED) {
      hideBubble()
      return
    }
    val signals = try {
      collect(root, pkg)
    } catch (e: Exception) {
      Log.w(TAG, "tree walk failed ($reason)", e)
      return
    }
    val result = ScreenClassifier.classify(signals)
    Log.i(TAG, "reclassify($reason) → ${result.kind}")
    if (result.kind != ScreenKind.NONE) showBubble(pkg, signals, result) else hideBubble()
  }

  override fun onInterrupt() {
    main.post { overlay?.hide() }
  }

  /**
   * Rotation. The bubble's position is absolute pixels against the old metrics, so
   * without this it can end up entirely off the new screen — see clampToScreen.
   */
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    // Delayed: displayMetrics still report the OLD orientation for a frame or two
    // after this fires, so clamping immediately clamps against the wrong screen.
    main.postDelayed({ overlay?.clampToScreen() }, ROTATION_SETTLE_MS)
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
    if (result.kind != ScreenKind.NONE) showBubble(pkg, signals, result) else hideBubble()
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
    var editable = false

    fun walk(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || visited >= MAX_NODES || depth > MAX_DEPTH) return
      visited++
      node.viewIdResourceName?.let { ids.add(it.lowercase()) }
      node.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { texts.add(it.lowercase()) }
      node.contentDescription?.toString()?.trim()?.takeIf { it.isNotEmpty() }
        ?.let { texts.add(it.lowercase()) }
      // A composer field is the chat classifier's strongest signal; note it once.
      if (!editable && (node.isEditable ||
          node.className?.toString()?.contains("EditText", ignoreCase = true) == true)) {
        editable = true
      }
      for (i in 0 until node.childCount) walk(node.getChild(i), depth + 1)
    }

    walk(root, 0)
    return ScreenSignals(packageName = pkg, viewIds = ids, texts = texts, hasEditable = editable)
  }

  // -------------------------------------------------------------------------
  // Bubble
  // -------------------------------------------------------------------------

  private fun showBubble(pkg: String, signals: ScreenSignals, result: Classification) {
    // Don't re-add on every content-changed for the same screen — it would restart
    // the entry animation and make the bubble flicker while scrolling a profile.
    // The kind is part of the signature so switching profile↔chat re-labels the
    // bubble instead of leaving a stale action wired up.
    val signature = result.kind.name + "|" + pkg + "|" + signals.viewIds.take(6).joinToString(",")
    if (overlay?.isShowing == true && signature == lastSignature) return
    lastSignature = signature
    val chat = result.kind == ScreenKind.CHAT
    val label = getString(if (chat) R.string.rizz_bubble_chat_label else R.string.rizz_bubble_label)
    // After the signature guard, so a scroll that re-fires content-changed on the
    // same screen does not inflate the impression count.
    RizzAnalytics.bubbleShown(this, result.kind)
    // Restart the leave-detection poll alongside the bubble it guards.
    main.removeCallbacks(presenceCheck)
    main.postDelayed(presenceCheck, PRESENCE_POLL_MS)
    main.post {
      overlay?.show(label) {
        RizzAnalytics.bubbleTapped(this, result.kind)
        if (chat) {
          overlay?.showToneMenu { tone ->
            onChatAnalyzeTapped(pkg, tone)
          }
        } else {
          onAnalyzeTapped(pkg, signals, result)
        }
      }
    }
  }

  private fun hideBubble() {
    if (overlay?.isShowing != true) return
    lastSignature = null
    main.removeCallbacks(presenceCheck)
    main.post { overlay?.hide() }
  }

  /**
   * Poll the foreground package while the bubble is up, and drop it the moment the
   * user leaves a supported app.
   *
   * `packageNames` in the accessibility config is an allowlist, so leaving
   * Instagram for the launcher delivers NO event at all — the `pkg !in SUPPORTED`
   * branch in onAccessibilityEvent can essentially never run. The bubble simply
   * stayed, floating over the home screen and over unrelated apps, which reads as
   * "this thing is watching everything I do" even though the service is genuinely
   * blind outside the allowlist.
   *
   * Widening `packageNames` would fix the detection and wreck both the battery
   * story and the Play-review story. Polling only while the bubble is visible
   * costs nothing when it is not, which is almost always.
   */
  private val presenceCheck = object : Runnable {
    override fun run() {
      if (overlay?.isShowing != true) return
      val pkg = rootInActiveWindow?.packageName?.toString()
      if (pkg != null && pkg !in ScreenClassifier.SUPPORTED) {
        Log.i(TAG, "left supported app ($pkg) — hiding")
        hideBubble()
        return
      }
      main.postDelayed(this, PRESENCE_POLL_MS)
    }
  }

  // -------------------------------------------------------------------------
  // Capture — only ever from a tap
  // -------------------------------------------------------------------------

  private fun onAnalyzeTapped(pkg: String, signals: ScreenSignals, result: Classification) {
    if (capturing) return
    capturing = true
    Log.i(TAG, "analyze tapped ($pkg, confidence=${result.confidence}, own=${result.isOwnProfile})")

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
      main.postDelayed({ capture(pkg, signals, result) }, 60)
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
  private fun capture(pkg: String, signals: ScreenSignals, result: Classification) {
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
                confidence = result.confidence,
                isOwnProfile = result.isOwnProfile,
              )
            )
            Log.i(TAG, "captured ${base64.length} b64 chars — launching app")
            // Push BEFORE the launch: if JS is already alive the event is the only
            // signal it gets, because bringing an already-foreground task forward
            // fires no AppState change for the pull to hang off.
            ProfileCaptureModule.notifyCapture()
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
      /*
       * REORDER_TO_FRONT alongside SINGLE_TOP.
       *
       * SINGLE_TOP alone only reuses the activity when it is already at the top of
       * its task. If the app is open on a modal — the paywall, the account gate —
       * the task came forward but the launch was otherwise inert, and since JS was
       * already 'active' the resume pull never ran either. The tap did nothing at
       * all. The event above is what actually delivers the capture now; this flag
       * makes sure the user is at least looking at our app when it arrives.
       */
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      )
      // Kept for a native reader that does not exist yet — nothing consumes this.
      // The capture is delivered by CaptureStore + the onCapture event, never here.
      putExtra(EXTRA_FROM_CAPTURE, true)
    }
    if (intent == null) {
      Log.w(TAG, "no launch intent")
      return
    }
    startActivity(intent)
  }

  // -------------------------------------------------------------------------
  // Chat — read the thread, suggest a reply, copy it. No screenshot, and it never
  // leaves the host app: the reply lands on the clipboard so the user just pastes
  // and sends. Generation is native (GeminiChatClient) because JS is not in the
  // loop here; the freemium rule still lives in JS and reaches us only as the
  // ChatEntitlement snapshot — the native side never decides who has credits.
  // -------------------------------------------------------------------------

  /** A scraped line and which side of the thread it sits on. */
  private data class ChatMsg(val text: String, val side: String) // "them" | "you" | ""

  private fun onChatAnalyzeTapped(pkg: String, tone: String) {
    if (capturing) return

    // Same order as the JS gate would apply: an unconfigured API is a different
    // failure from being out of credits, and both must say so rather than no-op.
    if (!ChatEntitlement.hasApi(this)) {
      toast(getString(R.string.rizz_chat_no_key))
      return
    }
    if (!ChatEntitlement.canGenerate(this)) {
      toast(getString(R.string.rizz_chat_out_of_credits))
      launchApp()
      return
    }

    capturing = true
    toast(getString(R.string.rizz_chat_reading))

    // Read the visible screen first (the newest messages — the ones that matter
    // most), THEN scroll up for history. batches[0] is newest.
    val batches = ArrayList<List<ChatMsg>>()
    rootInActiveWindow?.let { batches.add(readMessages(it)) }
    scrollAndRead(pkg, findScrollable(rootInActiveWindow), batches, CHAT_SCROLLS, 0, tone)

    // Backstop: whatever hangs downstream, never leave the button wedged. Generous
    // because a slow network generate legitimately takes many seconds.
    main.postDelayed({
      if (capturing) {
        Log.w(TAG, "chat watchdog fired — resetting")
        capturing = false
      }
    }, CHAT_WATCHDOG_MS)
  }

  /**
   * Scroll the thread up, reading between each step, to pull in history. Node scroll
   * actions (not gesture dispatch) so this needs no extra service capability. The
   * scrollable is re-found each step because the node goes stale after a scroll.
   */
  private fun scrollAndRead(
    pkg: String,
    scrollable: AccessibilityNodeInfo?,
    batches: ArrayList<List<ChatMsg>>,
    remaining: Int,
    scrolledUp: Int,
    tone: String,
  ) {
    if (remaining <= 0 || scrollable == null ||
      !scrollable.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
    ) {
      finishChat(pkg, batches, scrolledUp, tone)
      return
    }
    main.postDelayed({
      rootInActiveWindow?.let { batches.add(readMessages(it)) }
      scrollAndRead(pkg, findScrollable(rootInActiveWindow), batches, remaining - 1, scrolledUp + 1, tone)
    }, SCROLL_SETTLE_MS)
  }

  private fun finishChat(pkg: String, batches: ArrayList<List<ChatMsg>>, scrolledUp: Int, tone: String) {
    // Put the user back where they were — fire-and-forget, it doesn't affect the
    // transcript we've already collected.
    restoreScroll(scrolledUp)

    val transcript = buildTranscript(batches)
    if (transcript.isBlank()) {
      toast(getString(R.string.rizz_chat_unreadable))
      capturing = false
      return
    }

    chatExecutor.execute {
      val result = GeminiChatClient.suggestReply(this, transcript, tone)
      main.post {
        if (result == null) {
          // A failure must NOT charge — the server refunds its own charge, and
          // nothing is applied here.
          toast(getString(R.string.rizz_chat_failed))
        } else {
          copyToClipboard(result.reply)
          // The server's balance, verbatim. Never a local decrement — that would
          // count the same generation twice.
          ChatEntitlement.applyServerCredits(this, result.isPro, result.remaining)
          toast(getString(R.string.rizz_chat_copied))
          hideBubble()
        }
        capturing = false
      }
    }
  }

  /** Scroll back down [times] steps to restore the user's position. Best effort. */
  private fun restoreScroll(times: Int) {
    if (times <= 0) return
    val step = object : Runnable {
      var left = times
      override fun run() {
        findScrollable(rootInActiveWindow)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        if (--left > 0) main.postDelayed(this, SCROLL_SETTLE_MS)
      }
    }
    main.post(step)
  }

  /**
   * Flatten the visible tree into chat lines, tagging each them/you by horizontal
   * position — incoming bubbles hug the left, outgoing the right. Centred chrome
   * (name, timestamps) reads as unknown side and is passed through untagged; the
   * prompt is written to tolerate a noisy, possibly mis-tagged scrape.
   */
  private fun readMessages(root: AccessibilityNodeInfo): List<ChatMsg> {
    val out = ArrayList<ChatMsg>(32)
    val width = resources.displayMetrics.widthPixels.toFloat().coerceAtLeast(1f)
    val rect = Rect()
    var visited = 0

    fun walk(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || visited >= MAX_NODES || depth > MAX_DEPTH) return
      visited++
      val text = node.text?.toString()?.trim()
      // The composer's own text is not a message — skip editable nodes.
      if (!node.isEditable && !text.isNullOrEmpty() && text.length in 2..500) {
        node.getBoundsInScreen(rect)
        val side = when {
          rect.width() <= 0 -> ""
          rect.exactCenterX() < width * 0.42f -> "them"
          rect.exactCenterX() > width * 0.58f -> "you"
          else -> ""
        }
        out.add(ChatMsg(text, side))
      }
      for (i in 0 until node.childCount) walk(node.getChild(i), depth + 1)
    }

    walk(root, 0)
    return out
  }

  /**
   * Newest-first collection so that, when the thread is long, the cap keeps the
   * RECENT messages (which drive the reply) and drops the oldest. Reversed at the
   * end so the model reads it chronologically.
   */
  private fun buildTranscript(batches: List<List<ChatMsg>>): String {
    val seen = HashSet<String>()
    val newestFirst = ArrayList<ChatMsg>(MAX_TRANSCRIPT_LINES)
    outer@ for (batch in batches) {                 // batches[0] = newest screen
      for (msg in batch.asReversed()) {             // bottom→top = newer→older
        if (!seen.add(msg.text)) continue
        newestFirst.add(msg)
        if (newestFirst.size >= MAX_TRANSCRIPT_LINES) break@outer
      }
    }
    val lines = newestFirst.asReversed().map { msg ->
      when (msg.side) {
        "them" -> "them: ${msg.text}"
        "you" -> "you: ${msg.text}"
        else -> msg.text
      }
    }
    // takeLast keeps the newest end if we're still over the char budget.
    return lines.joinToString("\n").takeLast(MAX_TRANSCRIPT_CHARS)
  }

  private fun findScrollable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
    if (root == null) return null
    var best: AccessibilityNodeInfo? = null
    var bestHeight = 0
    val rect = Rect()
    var visited = 0

    fun walk(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || visited >= MAX_NODES || depth > MAX_DEPTH) return
      visited++
      if (node.isScrollable) {
        node.getBoundsInScreen(rect)
        // Tallest scrollable ≈ the message list, not a horizontal chip row.
        if (rect.height() > bestHeight) {
          bestHeight = rect.height()
          best = node
        }
      }
      for (i in 0 until node.childCount) walk(node.getChild(i), depth + 1)
    }

    walk(root, 0)
    return best
  }

  private fun copyToClipboard(text: String) {
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText("RizzCoach reply", text)
    /*
     * Marked sensitive so Android 13+ does not render the reply in its clipboard
     * preview toast.
     *
     * That preview draws over whatever app the user is in — including, by
     * definition here, a conversation somebody else may be looking at over their
     * shoulder. It is also the one place a line derived from a private thread
     * would appear in system UI. Our own "copied" toast is the confirmation; the
     * content itself does not need repeating.
     */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      clip.description.extras = PersistableBundle().apply {
        putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
      }
    }
    clipboard.setPrimaryClip(clip)
  }

  private fun toast(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
  }

  companion object {
    private const val TAG = "RizzA11y"
    private const val DEBOUNCE_MS = 400L

    /**
     * Grace before asking `rootInActiveWindow` after a bind or an unlock. It is
     * routinely null immediately after either, and a null read is indistinguishable
     * from "nothing to show" — so asking too early silently does nothing.
     */
    private const val RECONNECT_SETTLE_MS = 400L

    /** displayMetrics lag the rotation by a frame or two. See onConfigurationChanged. */
    private const val ROTATION_SETTLE_MS = 250L

    /**
     * How often to check we are still in a supported app WHILE the bubble is up.
     * Runs only for as long as the bubble exists — see [presenceCheck].
     */
    private const val PRESENCE_POLL_MS = 1500L

    /** Don't toast the overlay refusal more than this often. */
    private const val OVERLAY_WARN_INTERVAL_MS = 60_000L
    private const val MAX_NODES = 400
    private const val MAX_DEPTH = 25
    private const val MAX_EDGE = 1280
    private const val JPEG_QUALITY = 80
    const val EXTRA_FROM_CAPTURE = "rizz_from_capture"

    /** How many times the chat is scrolled up to read history. */
    private const val CHAT_SCROLLS = 3
    /** Wait for content to settle after a programmatic scroll before reading. */
    private const val SCROLL_SETTLE_MS = 450L
    /** Chat button reset backstop — generous, a slow generate is legitimate. */
    private const val CHAT_WATCHDOG_MS = 30000L
    private const val MAX_TRANSCRIPT_LINES = 40
    private const val MAX_TRANSCRIPT_CHARS = 4000

    /** True while the system has the service bound. */
    @Volatile
    var RUNNING = false
      private set

    /**
     * User-facing kill switch, flipped from JS. Enabling the service in Settings is
     * necessary but not sufficient — the user must also turn the feature on in the
     * app, so "enabled in Settings" never silently means "watching my screen".
     *
     * In-memory for fast reads on the event path; the durable copy lives in prefs
     * (see [setEnabledPersisted]) so it survives the process being killed.
     */
    @Volatile
    var ENABLED = false
      private set

    private const val PREFS = "rizz_analyzer"
    private const val KEY_ENABLED = "enabled"

    /**
     * Flip the kill switch AND persist it. Called from JS (`setEnabled`). Persisting
     * is what lets [onServiceConnected] restore the switch after the app process is
     * killed and the system rebinds the service with no JS running.
     */
    fun setEnabledPersisted(ctx: Context, enabled: Boolean) {
      ENABLED = enabled
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    private fun loadEnabled(ctx: Context): Boolean =
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)
  }
}
