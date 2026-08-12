package expo.modules.profilecapture

import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.TextView
import kotlin.math.abs

/**
 * The floating "✨ Analyze" bubble drawn over the supported apps.
 *
 * Deliberately built from a plain TextView rather than an inflated layout: it is
 * one pill with one label, and this keeps the module free of a res/layout dir and
 * an AppCompat dependency.
 *
 * The bubble sits over SOMEONE ELSE'S app, so it does not read theme tokens from
 * src/theme/tokens.ts — those are for our own screens. It carries the brand violet
 * and a dark pill that stays legible on both light and dark hosts.
 *
 * Accessibility of the bubble itself matters: an accessibility-API feature that is
 * unusable with TalkBack is a guaranteed review flag. Hence contentDescription and
 * a 48dp minimum touch target.
 */
class OverlayController(private val context: Context) {

  private val windowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var bubble: View? = null
  private var params: WindowManager.LayoutParams? = null
  private var scanAnim: ObjectAnimator? = null
  private var toneMenu: View? = null
  private var closeZone: View? = null
  private var sweep: View? = null
  private var sweepAnim: ObjectAnimator? = null
  private var sweepFlicker: ObjectAnimator? = null
  private var strike: View? = null
  private var strikeLanding: Runnable? = null
  private var strikeCleanup: Runnable? = null
  private var replyCard: View? = null
  var onCloseListener: (() -> Unit)? = null

  /**
   * The window manager refused us — overlay permission revoked mid-session, or an
   * OEM declining the window type.
   *
   * This used to be a `Log.w` and nothing else, which meant the feature died in
   * complete silence: the user had granted accessibility, the app's toggle still
   * read ON, and the bubble simply never appeared again with nothing anywhere to
   * explain it. The service turns this into something the user can act on.
   */
  var onShowFailed: ((Exception) -> Unit)? = null

  val isShowing: Boolean get() =
    bubble != null || toneMenu != null || closeZone != null || sweep != null ||
      strike != null || replyCard != null

  private fun dp(value: Float): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP, value, context.resources.displayMetrics
  ).toInt()

  @SuppressLint("ClickableViewAccessibility")
  fun show(label: String, onTap: () -> Unit) {
    if (bubble != null) return

    // Icon only. The label is carried by contentDescription rather than visible
    // text: this sits on top of someone else's app, so it should read as a control,
    // not a banner. 56dp keeps it a comfortable target with no text to size around.
    // The caller passes the label so the same bubble can announce "analyze this
    // profile" or "suggest a reply" depending on the screen underneath.
    /*
     * The launcher icon itself — `assets/icons/icon.png`, resized into this
     * module's drawable buckets as `rizz_bubble_icon`.
     *
     * It was a ✨ emoji, then a redrawn white bolt on a flat violet disc. Both
     * were wrong for the same reason: the thing floating over someone's chat has
     * to be the thing they recognise from their home screen, and a recoloured or
     * simplified version of a logo is a different logo as far as recognition
     * goes. Shipping the real artwork removes the question entirely — the bubble
     * cannot drift from the icon, because it IS the icon.
     *
     * Five density buckets (~97KB total) rather than one scaled file: this is
     * drawn at 56dp on top of somebody else's app, where a resampled PNG shows
     * its softness immediately.
     *
     * `clipToOutline` is what makes it a squircle. The PNG is a full-bleed square
     * — the launcher applies the mask, and over a chat window there is no
     * launcher, so we apply it ourselves or ship a rectangle.
     */
    val bubbleView = android.widget.ImageView(context).apply {
      setImageResource(R.drawable.rizz_bubble_icon)
      scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
      minimumWidth = dp(56f)
      minimumHeight = dp(56f)
      // TalkBack still announces the full action even though nothing is drawn.
      contentDescription = label
      outlineProvider = object : android.view.ViewOutlineProvider() {
        override fun getOutline(view: View, outline: android.graphics.Outline) {
          outline.setRoundRect(0, 0, view.width, view.height, dp(17f).toFloat())
        }
      }
      clipToOutline = true
      elevation = dp(6f).toFloat()
      alpha = 0f
      scaleX = 0.8f
      scaleY = 0.8f
    }

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      // NOT_FOCUSABLE so the host app keeps input — we must never steal the
      // keyboard or block a text field underneath.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      android.graphics.PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = context.resources.displayMetrics.widthPixels - dp(140f)
      y = (context.resources.displayMetrics.heightPixels * 0.45).toInt()
    }

    bubbleView.setOnTouchListener(DragTapListener(lp, onTap))

    try {
      windowManager.addView(bubbleView, lp)
      bubbleView.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(220).start()
      bubble = bubbleView
      params = lp
    } catch (e: Exception) {
      // Overlay permission revoked mid-session, or an OEM refusing the window.
      // Never crash the host app over a bubble — but never swallow it either.
      android.util.Log.w(TAG, "overlay add failed", e)
      onShowFailed?.invoke(e)
    }
  }

  /**
   * Play a short "scanning" beat, then remove the bubble and run [onDone].
   *
   * The bubble MUST be gone before the screenshot fires, or we capture our own
   * button sitting on top of the profile and hand it to the model. So the feedback
   * happens first and capture waits for it — the animation is not decoration, it is
   * the window in which we get off the screen.
   *
   * Kept short (~420ms): long enough to read as "it's working", short enough that
   * the app opening still feels like a response to the tap.
   */
  fun playScan() {
    val view = bubble ?: return
    scanAnim?.cancel()

    // ONE animator driving every property. Two `view.animate()` calls would share a
    // single ViewPropertyAnimator, so the second silently reconfigures the first.
    val anim = ObjectAnimator.ofPropertyValuesHolder(
      view,
      PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.18f, 0.9f),
      PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.18f, 0.9f),
      PropertyValuesHolder.ofFloat(View.ROTATION, 0f, 90f, 180f),
      PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 1f, 0f),
    ).apply {
      duration = SCAN_MS
      interpolator = LinearInterpolator()
    }
    scanAnim = anim
    anim.start()
  }

  /**
   * Pull the bubble back on screen after a rotation.
   *
   * `lp.x/y` are absolute pixels chosen against the metrics that were current when
   * the bubble was added, and FLAG_LAYOUT_NO_LIMITS means the window manager will
   * happily honour a position that is now off the edge — so rotating a phone with
   * the bubble on the right of a landscape screen left it entirely outside a
   * portrait one, with no way to get it back short of killing the service.
   *
   * The transient windows go rather than move: the tone menu's position is derived
   * from the bubble's, and the close zone only exists mid-drag, which a rotation
   * has already interrupted.
   */
  fun clampToScreen() {
    hideToneMenu()
    hideCloseZone()
    val view = bubble ?: return
    val lp = params ?: return
    val metrics = context.resources.displayMetrics
    // Width can read 0 before the first layout pass; fall back to the fixed 56dp.
    val w = if (view.width > 0) view.width else dp(56f)
    val h = if (view.height > 0) view.height else dp(56f)
    lp.x = lp.x.coerceIn(0, (metrics.widthPixels - w).coerceAtLeast(0))
    lp.y = lp.y.coerceIn(0, (metrics.heightPixels - h).coerceAtLeast(0))
    runCatching { windowManager.updateViewLayout(view, lp) }
  }

  fun hide() {
    val bView = bubble
    val tView = toneMenu
    bubble = null
    toneMenu = null
    params = null
    scanAnim?.cancel()
    scanAnim = null
    hideCloseZone()
    // Both are their own windows, so neither goes away with the bubble. A sweep
    // left running over somebody else's app after the feature was turned off is
    // the worst bug this file could ship.
    hideSweep()
    hideStrike()
    hideReply()
    try {
      if (bView != null) windowManager.removeView(bView)
      if (tView != null) windowManager.removeView(tView)
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay remove failed", e)
    }
  }

  // ── Reading feedback ────────────────────────────────────────────────────────

  /**
   * A violet band travelling down the screen while the thread is being read.
   *
   * ## Why this exists
   *
   * Reading a chat takes three scroll steps with a settle between each, plus the
   * generate — several seconds during which the only feedback was one toast that
   * had already faded, while the user watched their own conversation scroll
   * upward on its own. That is indistinguishable from the app malfunctioning.
   * The sweep says "this is me, I am doing the thing you asked for", and it ends
   * exactly when the read does, so its length is honest rather than a guess.
   *
   * ## The two rules this window must never break
   *
   * `FLAG_NOT_TOUCHABLE` — it covers the whole screen, and without this it would
   * swallow every tap meant for the app underneath. There is nothing to press on
   * it, so it should be invisible to touch as well as harmless to look at.
   *
   * **A band, not a panel.** We read the accessibility tree, not pixels, so
   * nothing here needs to obscure the thread — and an app that draws an opaque
   * layer over another app's content is a very different thing to explain to
   * Play review than one that draws a thin line. Keep it translucent, keep it
   * moving, keep it short-lived.
   */
  fun showSweep() {
    if (sweep != null) return
    val metrics = context.resources.displayMetrics
    val bandHeight = dp(120f)

    val band = View(context).apply {
      background = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(Color.TRANSPARENT, Color.parseColor("#598B5CF6"), Color.TRANSPARENT),
      )
    }
    val host = android.widget.FrameLayout(context).apply {
      addView(
        band,
        android.widget.FrameLayout.LayoutParams(
          android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
          bandHeight,
        ),
      )
    }

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      android.graphics.PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }

    try {
      windowManager.addView(host, lp)
      sweep = host
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay sweep add failed", e)
      return
    }

    sweepAnim = ObjectAnimator.ofFloat(
      band,
      View.TRANSLATION_Y,
      -bandHeight.toFloat(),
      metrics.heightPixels.toFloat(),
    ).apply {
      duration = SWEEP_MS
      repeatCount = ObjectAnimator.INFINITE
      interpolator = LinearInterpolator()
      start()
    }

    /*
     * The flicker is what makes this read as CHARGING rather than as a progress
     * bar going round. The mark is a bolt, so the wait should look like one
     * building — and an uneven pulse is the difference between electricity and a
     * loading spinner. Cheap: one extra animator on a view that is already
     * composited, running only while a read is in flight.
     */
    sweepFlicker = ObjectAnimator.ofFloat(band, View.ALPHA, 0.55f, 1f).apply {
      duration = FLICKER_MS
      repeatCount = ObjectAnimator.INFINITE
      repeatMode = ObjectAnimator.REVERSE
      interpolator = LinearInterpolator()
      start()
    }
  }

  /**
   * The bolt leaves the bubble, lands where the reply card is about to open, and
   * only then does the card appear.
   *
   * ## Why it strikes the card and not "the clipboard"
   *
   * The clipboard has no position on screen — it is not a thing anyone can point
   * at — so a bolt flying toward it would be an animation aimed at nothing. The
   * card IS the clipboard made visible: it is the first and only place the copied
   * text exists for the user. Striking it is therefore literally true rather than
   * decorative, and it explains the card's arrival instead of the card simply
   * appearing.
   *
   * ## Why the card waits for [onLanded]
   *
   * Cause before effect. Run them together and it reads as two unrelated things
   * happening at once; run the card off the landing and the whole beat reads as
   * one action — which is the point of using the brand mark for it at all.
   *
   * Its own window because it has to travel from the bubble (mid-right, wherever
   * the user dragged it) to the card (top-centre), and neither of those windows
   * contains both points.
   */
  fun playStrike(onLanded: () -> Unit) {
    val start = params
    if (start == null) {
      // No bubble to throw from — skip straight to the payload rather than
      // swallowing it. The reply matters; the animation does not.
      onLanded()
      return
    }
    val metrics = context.resources.displayMetrics

    /*
     * The rectangle the bolt is drawn across: from the bubble to the card.
     *
     * The arc lives in a 100x100 viewport (see rizz_bolt_arc.xml) which is
     * stretched over this box, so the same path serves a bubble parked anywhere
     * on either edge. Mirrored below when the bubble is on the left, because the
     * path is authored bottom-right → top-left.
     */
    val bubbleHalf = dp(28f)
    val fromX = start.x + bubbleHalf
    val fromY = start.y + bubbleHalf
    val toX = metrics.widthPixels / 2
    val toY = dp(REPLY_CARD_TOP_DP + 26f)
    val left = minOf(fromX, toX)
    val top = minOf(fromY, toY)
    val width = kotlin.math.abs(fromX - toX).coerceAtLeast(dp(48f))
    val height = kotlin.math.abs(fromY - toY).coerceAtLeast(dp(48f))

    val boltView = android.widget.ImageView(context).apply {
      setImageResource(R.drawable.rizz_bolt_strike)
      scaleType = android.widget.ImageView.ScaleType.FIT_XY
      // The path runs bottom-right → top-left; flip it for a left-parked bubble
      // rather than shipping a second mirrored copy that can drift from this one.
      if (fromX < toX) scaleX = -1f
      // Decorative and transient — TalkBack already has the reply on the card.
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    /*
     * The impact flash.
     *
     * The cheapest and most convincing part of the whole effect: the eye reads a
     * change in BRIGHTNESS as energy far more readily than it reads motion. Two
     * frames of a near-white wash at the moment of landing does more work than
     * the travel animation it follows. Kept at 0.10 alpha and 90ms — any heavier
     * and it stops being a flash and starts being our app whiting out somebody
     * else's chat.
     */
    val flash = View(context).apply {
      setBackgroundColor(Color.parseColor("#EADCFF"))
      alpha = 0f
    }

    val host = android.widget.FrameLayout(context).apply {
      addView(
        flash,
        android.widget.FrameLayout.LayoutParams(
          android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
          android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
        ),
      )
      addView(boltView, android.widget.FrameLayout.LayoutParams(width, height))
    }
    boltView.x = left.toFloat()
    boltView.y = top.toFloat()

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      // Same rule as the sweep: it covers the screen, so it must be invisible to
      // touch or it eats a tap meant for the app underneath.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      android.graphics.PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }

    try {
      windowManager.addView(host, lp)
      strike = host
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay strike add failed", e)
      onLanded()
      return
    }

    (boltView.drawable as? android.graphics.drawable.Animatable)?.start()

    /*
     * The landing beat, scheduled off a Handler rather than an AVD callback.
     *
     * `AnimatedVectorDrawable` only gained a listener API at API 23 and it is
     * lost outright if the view detaches mid-animation — which is exactly what
     * `hide()` does. Losing it would mean the reply silently never appears, so
     * the payload rides a plain `postDelayed` and the drawable is left to draw
     * itself. Same reasoning as SCAN_MS in the profile path.
     */
    strikeLanding = Runnable {
      strikeLanding = null
      flash.animate().alpha(0.10f).setDuration(FLASH_MS).withEndAction {
        flash.animate().alpha(0f).setDuration(FLASH_MS * 2).start()
      }.start()
      /*
       * A short tick at the moment of impact.
       *
       * The whole effect is a physical metaphor and the device is in the user's
       * hand — a strike they feel is worth more than any number of frames they
       * only see. 18ms is a tap, not a buzz. Silent if the OS or the user has
       * haptics off, which `VibratorManager` handles for us.
       */
      runCatching {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)
            as android.os.VibratorManager).defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
        }
        vibrator.vibrate(
          android.os.VibrationEffect.createOneShot(18L, android.os.VibrationEffect.DEFAULT_AMPLITUDE),
        )
      }
      onLanded()
      // Long enough for the flash to finish before the window goes.
      strikeCleanup = Runnable { hideStrike() }
      host.postDelayed(strikeCleanup!!, FLASH_MS * 3)
    }
    host.postDelayed(strikeLanding!!, STRIKE_MS)
  }

  fun hideStrike() {
    val view = strike ?: return
    strike = null
    // Both are payload-bearing: `strikeLanding` shows the reply. Dropping it here
    // is deliberate — the only caller of `hideStrike` before the landing is
    // `hide()`, i.e. the user just dragged the bubble onto ✕, and a card opening
    // after that lands on a screen where they turned the feature off.
    strikeLanding?.let { view.removeCallbacks(it) }
    strikeCleanup?.let { view.removeCallbacks(it) }
    strikeLanding = null
    strikeCleanup = null
    runCatching { windowManager.removeView(view) }
  }

  fun hideSweep() {
    val view = sweep ?: return
    sweep = null
    sweepAnim?.cancel()
    sweepAnim = null
    sweepFlicker?.cancel()
    sweepFlicker = null
    runCatching { windowManager.removeView(view) }
  }

  /**
   * The bubble fires as the reply lands on the clipboard.
   *
   * Not a bolt travelling to the clipboard, which was the obvious idea and does
   * not work: the clipboard is not anywhere on screen, so the animation would be
   * pointing at nothing. What the user needs to understand is *the bubble did
   * that* — so the energy comes out of the bubble itself and the reply card
   * arrives in the same beat. One animator, same reason as `playScan`.
   */
  fun playBurst() {
    val view = bubble ?: return
    scanAnim?.cancel()
    val anim = ObjectAnimator.ofPropertyValuesHolder(
      view,
      PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.45f, 0.92f, 1f),
      PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.45f, 0.92f, 1f),
      PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 0.55f, 1f, 1f),
    ).apply {
      duration = BURST_MS
      interpolator = LinearInterpolator()
    }
    scanAnim = anim
    anim.start()
  }

  /**
   * Show the generated reply, because the user is about to paste it blind.
   *
   * The toast said "Reply copied — paste & send" and then vanished, so the first
   * time anyone saw what this app had written for them was *after* it was in the
   * message box, one tap from being sent to a real person. Reading it first is
   * not a nicety here, it is the difference between a tool and a gamble.
   *
   * Pinned to the TOP of the screen on purpose: the thread's newest messages and
   * the compose field are at the bottom, and a card that covers either is a card
   * that gets dismissed before it is read. Tap anywhere on it to copy again —
   * the clipboard is easily lost to whatever the user copies next.
   *
   * Touchable, unlike the sweep, but never focusable: taking focus would close
   * the host app's keyboard, which is the one thing the user needs open next.
   */
  fun showReply(reply: String, onCopyAgain: () -> Unit) {
    hideReply()

    val card = android.widget.LinearLayout(context).apply {
      orientation = android.widget.LinearLayout.VERTICAL
      setPadding(dp(16f), dp(14f), dp(16f), dp(14f))
      background = GradientDrawable().apply {
        cornerRadius = dp(20f).toFloat()
        setColor(Color.parseColor("#13131E"))
        setStroke(dp(1.5f), Color.parseColor("#8B5CF6"))
      }
      elevation = dp(10f).toFloat()
      addView(TextView(context).apply {
        text = context.getString(R.string.rizz_chat_copied)
        setTextColor(Color.parseColor("#A78BFA"))
        textSize = 11f
      })
      addView(TextView(context).apply {
        text = reply
        setTextColor(Color.WHITE)
        textSize = 15f
        // Long replies exist; cap it so the card can never grow into the thread.
        maxLines = 4
        ellipsize = android.text.TextUtils.TruncateAt.END
        setPadding(0, dp(6f), 0, dp(6f))
      })
      addView(TextView(context).apply {
        text = context.getString(R.string.rizz_chat_tap_to_copy)
        setTextColor(Color.parseColor("#868697"))
        textSize = 10f
      })
      isClickable = true
      contentDescription = reply
      setOnClickListener { onCopyAgain() }
    }

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      android.graphics.PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP
      // Shared with playStrike's target — the bolt has to land where the card
      // opens, and two copies of this number is how they drift apart.
      y = dp(REPLY_CARD_TOP_DP)
      // Inset from both edges without a margin, so MATCH_PARENT still centres it.
      horizontalMargin = 0.04f
    }

    try {
      windowManager.addView(card, lp)
      replyCard = card
      // Expands from the strike point rather than sliding in: the bolt just
      // landed here, so the card should look like what it left behind.
      card.alpha = 0f
      card.scaleX = 0.86f
      card.scaleY = 0.86f
      card.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(BURST_MS).start()
      // Auto-dismiss: this sits on top of somebody else's app, and a card that
      // needs dismissing is a card in the way. Long enough to read four lines.
      card.postDelayed({ hideReply() }, REPLY_CARD_MS)
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay reply card add failed", e)
    }
  }

  fun hideReply() {
    val view = replyCard ?: return
    replyCard = null
    runCatching { windowManager.removeView(view) }
  }

  fun showToneMenu(onToneSelected: (String) -> Unit) {
    val bView = bubble ?: return
    val currentParams = params ?: return

    bView.visibility = View.GONE

    val container = android.widget.LinearLayout(context).apply {
      orientation = android.widget.LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(8f), dp(4f), dp(8f), dp(4f))
      background = GradientDrawable().apply {
        cornerRadius = dp(28f).toFloat()
        setColor(Color.parseColor("#13131E"))
        setStroke(dp(1.5f), Color.parseColor("#8B5CF6"))
      }
      elevation = dp(8f).toFloat()
    }

    /**
     * One emoji, one action.
     *
     * The names were briefly rendered under each glyph and are now back in
     * `contentDescription` only. Four labelled columns made the menu roughly
     * twice as wide, and this floats over the thread it is about to read — the
     * width is not free space, it is the user's conversation. The emoji carry
     * the meaning well enough at the moment of choosing (🔮 read the room, 🔥
     * tease, 🎭 make them laugh), and the names are still there for TalkBack,
     * which is the one audience that genuinely could not do without them.
     */
    fun createOptionButton(emoji: String, labelRes: Int, onClick: () -> Unit): View {
      return TextView(context).apply {
        text = emoji
        gravity = Gravity.CENTER
        width = dp(44f)
        height = dp(44f)
        textSize = 19f
        setTextColor(Color.WHITE)
        contentDescription = context.getString(labelRes)
        setOnClickListener { onClick() }
      }
    }

    container.addView(createOptionButton("🔮", R.string.rizz_tone_vibe) {
      hideToneMenu()
      onToneSelected("vibe")
    })
    container.addView(createOptionButton("🔥", R.string.rizz_tone_roast) {
      hideToneMenu()
      onToneSelected("roast")
    })
    container.addView(createOptionButton("🎭", R.string.rizz_tone_comedy) {
      hideToneMenu()
      onToneSelected("comedy")
    })
    container.addView(TextView(context).apply {
      text = "|"
      setTextColor(Color.parseColor("#33FFFFFF"))
      gravity = Gravity.CENTER
      width = dp(10f)
      height = dp(44f)
      textSize = 14f
    })
    container.addView(createOptionButton("✕", R.string.rizz_tone_cancel) {
      hideToneMenu()
    })

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val screenW = context.resources.displayMetrics.widthPixels
    /*
     * Measured, not the hardcoded 190dp this used to be.
     *
     * The buttons carry a word under the emoji now, so the menu is wider — and
     * how much wider depends on the OS font scale and on the translation, which
     * is exactly the kind of number that must not be guessed. A too-small fixed
     * width clipped the last button off; a too-large one pushed the menu off the
     * screen edge, and the `x` below is derived from it, so a wrong value also
     * lands the menu in the wrong place.
     */
    container.measure(
      View.MeasureSpec.makeMeasureSpec(screenW, View.MeasureSpec.AT_MOST),
      View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
    )
    val menuWidth = container.measuredWidth.coerceIn(dp(190f), screenW)
    val lp = WindowManager.LayoutParams(
      menuWidth,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      android.graphics.PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = if (currentParams.x + dp(56f)/2 < screenW / 2) {
        currentParams.x
      } else {
        (currentParams.x + dp(56f) - menuWidth).coerceAtLeast(0)
      }
      y = currentParams.y
    }

    try {
      windowManager.addView(container, lp)
      toneMenu = container
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay tone menu add failed", e)
      bView.visibility = View.VISIBLE
    }
  }

  fun hideToneMenu() {
    val tView = toneMenu
    toneMenu = null
    if (tView != null) {
      try {
        windowManager.removeView(tView)
      } catch (e: Exception) {
        android.util.Log.w(TAG, "overlay remove tone menu failed", e)
      }
    }
    bubble?.visibility = View.VISIBLE
  }

  private fun showCloseZone() {
    if (closeZone != null) return
    val zone = android.widget.FrameLayout(context).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#E11D48")) // Rose red
        setStroke(dp(2f), Color.WHITE)
      }
      elevation = dp(8f).toFloat()

      addView(TextView(context).apply {
        text = "✕"
        setTextColor(Color.WHITE)
        textSize = 20f
        gravity = Gravity.CENTER
        layoutParams = android.widget.FrameLayout.LayoutParams(
          android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
          android.widget.FrameLayout.LayoutParams.MATCH_PARENT
        )
      })
    }

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val size = dp(56f)
    val lp = WindowManager.LayoutParams(
      size,
      size,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = dp(56f) // Bottom margin
    }

    try {
      windowManager.addView(zone, lp)
      closeZone = zone
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay close zone add failed", e)
    }
  }

  private fun hideCloseZone() {
    val zone = closeZone
    closeZone = null
    if (zone != null) {
      try {
        windowManager.removeView(zone)
      } catch (e: Exception) {
        android.util.Log.w(TAG, "overlay remove close zone failed", e)
      }
    }
  }

  /**
   * Distinguishes a drag from a tap, and snaps the bubble to the nearest edge.
   * Without the slop check every drag would also fire an analyze.
   */
  private inner class DragTapListener(
    private val lp: WindowManager.LayoutParams,
    private val onTap: () -> Unit,
  ) : View.OnTouchListener {
    private var startX = 0
    private var startY = 0
    private var touchX = 0f
    private var touchY = 0f
    private var dragging = false
    private val slop = dp(8f)

    override fun onTouch(v: View, event: MotionEvent): Boolean {
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          startX = lp.x; startY = lp.y
          touchX = event.rawX; touchY = event.rawY
          dragging = false
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - touchX).toInt()
          val dy = (event.rawY - touchY).toInt()
          if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
            dragging = true
            showCloseZone()
          }
          if (dragging) {
            lp.x = startX + dx
            lp.y = startY + dy
            runCatching { windowManager.updateViewLayout(v, lp) }

            val bubbleLoc = IntArray(2)
            v.getLocationOnScreen(bubbleLoc)
            val bubbleCenterX = bubbleLoc[0] + v.width / 2
            val bubbleCenterY = bubbleLoc[1] + v.height / 2

            val zoneLoc = IntArray(2)
            closeZone?.getLocationOnScreen(zoneLoc)
            val zoneCenterX = zoneLoc[0] + (closeZone?.width ?: 0) / 2
            val zoneCenterY = zoneLoc[1] + (closeZone?.height ?: 0) / 2

            if (closeZone != null) {
              val dist = Math.hypot(
                (bubbleCenterX - zoneCenterX).toDouble(),
                (bubbleCenterY - zoneCenterY).toDouble()
              )
              if (dist < dp(100f)) {
                closeZone?.scaleX = 1.3f
                closeZone?.scaleY = 1.3f
              } else {
                closeZone?.scaleX = 1.0f
                closeZone?.scaleY = 1.0f
              }
            }
          }
          return true
        }
        MotionEvent.ACTION_UP -> {
          if (dragging) {
            var closed = false
            val bubbleLoc = IntArray(2)
            v.getLocationOnScreen(bubbleLoc)
            val bubbleCenterX = bubbleLoc[0] + v.width / 2
            val bubbleCenterY = bubbleLoc[1] + v.height / 2

            val zoneLoc = IntArray(2)
            closeZone?.getLocationOnScreen(zoneLoc)
            val zoneCenterX = zoneLoc[0] + (closeZone?.width ?: 0) / 2
            val zoneCenterY = zoneLoc[1] + (closeZone?.height ?: 0) / 2

            if (closeZone != null) {
              val dist = Math.hypot(
                (bubbleCenterX - zoneCenterX).toDouble(),
                (bubbleCenterY - zoneCenterY).toDouble()
              )
              if (dist < dp(100f)) {
                closed = true
              }
            }

            hideCloseZone()

            if (closed) {
              onCloseListener?.invoke()
              hide()
            } else {
              val screenW = context.resources.displayMetrics.widthPixels
              lp.x = if (lp.x + v.width / 2 < screenW / 2) dp(8f) else screenW - v.width - dp(8f)
              runCatching { windowManager.updateViewLayout(v, lp) }
            }
          } else {
            v.performClick()
            onTap()
          }
          return true
        }
        MotionEvent.ACTION_CANCEL -> {
          hideCloseZone()
          val screenW = context.resources.displayMetrics.widthPixels
          lp.x = if (lp.x + v.width / 2 < screenW / 2) dp(8f) else screenW - v.width - dp(8f)
          runCatching { windowManager.updateViewLayout(v, lp) }
          return true
        }
      }
      return false
    }
  }

  companion object {
    private const val TAG = "RizzOverlay"

    /**
     * Length of the scan beat. The service schedules capture off this on a plain
     * Handler rather than an animation callback: a callback can be lost if the view
     * is detached mid-animation, and losing it means the tap silently does nothing.
     */
    const val SCAN_MS = 400L

    /**
     * One pass of the reading sweep, top to bottom.
     *
     * Not tied to how long the read takes, and it must not be: the read is three
     * scrolls plus a network generate, so its length varies from about two
     * seconds to fifteen. The sweep loops until the read ends and is cancelled
     * by the caller, which is the only honest way to animate an unknown wait.
     */
    private const val SWEEP_MS = 1100L

    /** The bubble discharging as the reply lands. */
    private const val BURST_MS = 260L

    /**
     * How long the reply stays on screen before it dismisses itself.
     *
     * It sits on top of another app, so it cannot wait to be dismissed — but it
     * has to outlast reading four lines and then switching attention to the
     * message box. Six seconds is that, and it is also the clipboard's practical
     * lifetime before the user copies something else.
     */
    private const val REPLY_CARD_MS = 6000L

    /** Distance from the top of the screen to the reply card, in dp. */
    private const val REPLY_CARD_TOP_DP = 48f

    /**
     * When the strike lands — matched to the draw in `rizz_bolt_strike.xml`.
     *
     * Was 380ms of a glyph sliding. The bolt is now DRAWN along its path in
     * 180ms, which is at the edge of reading as instantaneous while still being
     * seen: longer and it becomes a loading animation, shorter and half the
     * users never register that anything happened. If the XML durations change,
     * this changes with them.
     */
    private const val STRIKE_MS = 190L

    /** One half of the impact flash — up in this, down in twice it. */
    private const val FLASH_MS = 90L

    /**
     * One beat of the charge flicker. Deliberately not a divisor of [SWEEP_MS] —
     * two loops on a common multiple resynchronise every cycle and start reading
     * as one regular pulse, which is the metronome look this is trying to avoid.
     */
    private const val FLICKER_MS = 170L
  }
}
