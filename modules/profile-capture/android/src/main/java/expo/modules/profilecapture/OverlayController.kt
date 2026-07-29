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
  var onCloseListener: (() -> Unit)? = null

  val isShowing: Boolean get() = bubble != null || toneMenu != null || closeZone != null

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
    val bubbleView = TextView(context).apply {
      text = "✨"
      setTextColor(Color.WHITE)
      textSize = 22f
      gravity = Gravity.CENTER
      width = dp(56f)
      height = dp(56f)
      // TalkBack still announces the full action even though nothing is drawn.
      contentDescription = label
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        // palette.violet, opaque so it stays legible on a white host app.
        setColor(Color.parseColor("#8B5CF6"))
        setStroke(dp(1f), Color.parseColor("#33FFFFFF"))
      }
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
      // Never crash the host app over a bubble.
      android.util.Log.w(TAG, "overlay add failed", e)
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

  fun hide() {
    val bView = bubble
    val tView = toneMenu
    bubble = null
    toneMenu = null
    params = null
    scanAnim?.cancel()
    scanAnim = null
    hideCloseZone()
    try {
      if (bView != null) windowManager.removeView(bView)
      if (tView != null) windowManager.removeView(tView)
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay remove failed", e)
    }
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

    fun createOptionButton(emoji: String, contentDesc: String, onClick: () -> Unit): TextView {
      return TextView(context).apply {
        text = emoji
        gravity = Gravity.CENTER
        width = dp(42f)
        height = dp(42f)
        textSize = 18f
        setTextColor(Color.WHITE) // Set text color to white
        contentDescription = contentDesc
        setOnClickListener { onClick() }
      }
    }

    container.addView(createOptionButton("🔮", "Vibe") {
      hideToneMenu()
      onToneSelected("vibe")
    })
    container.addView(createOptionButton("🔥", "Roast") {
      hideToneMenu()
      onToneSelected("roast")
    })
    container.addView(createOptionButton("🎭", "Comedy") {
      hideToneMenu()
      onToneSelected("comedy")
    })
    container.addView(TextView(context).apply {
      text = "|"
      setTextColor(Color.parseColor("#33FFFFFF"))
      gravity = Gravity.CENTER
      width = dp(10f)
      height = dp(42f)
      textSize = 14f
    })
    container.addView(createOptionButton("✕", "Cancel") {
      hideToneMenu()
    })

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val screenW = context.resources.displayMetrics.widthPixels
    val menuWidth = dp(190f)
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
  }
}
