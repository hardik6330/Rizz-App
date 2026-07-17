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

  val isShowing: Boolean get() = bubble != null

  private fun dp(value: Float): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP, value, context.resources.displayMetrics
  ).toInt()

  @SuppressLint("ClickableViewAccessibility")
  fun show(onTap: () -> Unit) {
    if (bubble != null) return

    // Icon only. The label is carried by contentDescription rather than visible
    // text: this sits on top of someone else's app, so it should read as a control,
    // not a banner. 56dp keeps it a comfortable target with no text to size around.
    val label = TextView(context).apply {
      text = "✨"
      setTextColor(Color.WHITE)
      textSize = 22f
      gravity = Gravity.CENTER
      width = dp(56f)
      height = dp(56f)
      // TalkBack still announces the full action even though nothing is drawn.
      contentDescription = context.getString(R.string.rizz_bubble_label)
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

    label.setOnTouchListener(DragTapListener(lp, onTap))

    try {
      windowManager.addView(label, lp)
      label.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(220).start()
      bubble = label
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
  fun playScanThen(onDone: () -> Unit) {
    val view = bubble ?: run { onDone(); return }

    // Pulse + spin reads as "working" without needing a custom view or a spinner.
    val pulse = ObjectAnimator.ofPropertyValuesHolder(
      view,
      PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.18f, 0.92f),
      PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.18f, 0.92f),
    ).apply {
      duration = 420
      interpolator = LinearInterpolator()
      repeatCount = 0
    }
    scanAnim = pulse
    view.animate().rotationBy(180f).setDuration(420).setInterpolator(LinearInterpolator()).start()
    pulse.start()

    // Fade out over the tail of the pulse so the bubble is off-screen before capture.
    view.animate()
      .alpha(0f)
      .setStartDelay(260)
      .setDuration(160)
      .withEndAction {
        hide()
        onDone()
      }
      .start()
  }

  fun hide() {
    val view = bubble ?: return
    bubble = null
    params = null
    scanAnim?.cancel()
    scanAnim = null
    try {
      windowManager.removeView(view)
    } catch (e: Exception) {
      android.util.Log.w(TAG, "overlay remove failed", e)
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
          if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
          if (dragging) {
            lp.x = startX + dx
            lp.y = startY + dy
            runCatching { windowManager.updateViewLayout(v, lp) }
          }
          return true
        }
        MotionEvent.ACTION_UP -> {
          if (dragging) {
            // Snap to whichever edge is closer.
            val screenW = context.resources.displayMetrics.widthPixels
            lp.x = if (lp.x + v.width / 2 < screenW / 2) dp(8f) else screenW - v.width - dp(8f)
            runCatching { windowManager.updateViewLayout(v, lp) }
          } else {
            v.performClick()
            onTap()
          }
          return true
        }
      }
      return false
    }
  }

  companion object {
    private const val TAG = "RizzOverlay"
  }
}
