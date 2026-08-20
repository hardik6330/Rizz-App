package expo.modules.profilecapture

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.text.TextUtils
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * JS bridge for the accessibility capture flow.
 *
 * Exposes permission state, a kill switch, and a pull-based hand-off. JS pulls the
 * pending capture on resume rather than the service pushing an event, because the
 * service runs when the React context does not exist — there is often nothing to
 * push to. Pull-on-resume has no timing hazard.
 */
class ProfileCaptureModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  class CaptureRecord : Record {
    @Field var base64: String = ""
    @Field var app: String = ""
    @Field var uiText: String = ""
    @Field var confidence: Double = 0.0
    @Field var isOwnProfile: Boolean = false
  }

  override fun definition() = ModuleDefinition {
    Name("ProfileCapture")

    /**
     * Fired when the service stashes a capture AND a React context exists.
     *
     * The pull-on-resume path cannot cover every case: `launchApp()` uses
     * SINGLE_TOP, so when the app is already foreground — sitting on the paywall,
     * or the account gate — bringing the task forward changes nothing about
     * AppState, no 'active' fires, and the pull never runs. The user taps ✨ and
     * watches the app do nothing. This is the push half; the pull stays for the
     * cold-start case, where there is no listener to fire at.
     */
    Events(EVENT_CAPTURE)

    OnCreate { instance = this@ProfileCaptureModule }
    OnDestroy { instance = null }

    /** Has the user enabled our service in Settings → Accessibility? */
    Function("isAccessibilityEnabled") { isAccessibilityEnabled(context) }

    /** Can we draw the bubble over other apps? */
    Function("canDrawOverlays") { Settings.canDrawOverlays(context) }

    /** True only when both permissions are granted AND the in-app switch is on. */
    Function("isWatching") {
      RizzAccessibilityService.ENABLED &&
        RizzAccessibilityService.RUNNING &&
        Settings.canDrawOverlays(context)
    }

    /**
     * In-app kill switch. Granting accessibility in Settings must never by itself
     * mean "watching my screen" — the user turns the feature on here.
     */
    Function("setEnabled") { enabled: Boolean ->
      // Persisted so the switch survives the app process being killed — the service
      // restores it in onServiceConnected. See RizzAccessibilityService.
      RizzAccessibilityService.setEnabledPersisted(context, enabled)
      if (!enabled) CaptureStore.clear()
      enabled
    }

    Function("isEnabled") { RizzAccessibilityService.ENABLED }

    /**
     * The four bits behind `isWatching`, separately — so the app can tell WHY it
     * is not watching.
     *
     * `isWatching()` collapses them into one boolean, which cannot distinguish
     * "the user turned it off" from "the OS killed our process and never rebound
     * the service". The second is what MIUI, ColorOS and FuntouchOS do on swipe
     * away, and it is unrecoverable without the user going back into Settings —
     * so it needs different copy, not the same generic prompt.
     *
     * `accessibility && !running` is the killed case: granted in Settings, but no
     * bound service to show for it.
     */
    Function("diagnose") {
      mapOf(
        "accessibility" to isAccessibilityEnabled(context),
        "overlay" to Settings.canDrawOverlays(context),
        "enabled" to RizzAccessibilityService.ENABLED,
        "running" to RizzAccessibilityService.RUNNING,
      )
    }

    Function("openAccessibilitySettings") {
      context.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    Function("openOverlaySettings") {
      context.startActivity(
        Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    /** Is a capture waiting? Non-destructive — the store keeps it. */
    Function("hasPendingCapture") { CaptureStore.peek() != null }

    /** Take the pending capture, clearing it. Null when there is none. */
    Function("consumePendingCapture") {
      CaptureStore.consume()?.let {
        CaptureRecord().apply {
          base64 = it.base64
          app = it.app
          uiText = it.uiText
          confidence = it.confidence
          isOwnProfile = it.isOwnProfile
        }
      }
    }

    Function("clearPendingCapture") { CaptureStore.clear() }

    // --- Chat reply (inline) -------------------------------------------------
    // The chat bubble generates a reply natively and copies it to the clipboard,
    // so JS is not in the loop at tap time. These two functions are the whole
    // contract: JS pushes a credit/key snapshot down, and drains the usage the
    // native side accrued. The freemium RULE stays in JS — see ChatEntitlement.

    /**
     * Push the current entitlement snapshot + Gemini key to the service. Call on
     * launch and on every resume so the native cache never goes stale.
     */
    Function("configureChat") { apiUrl: String, installId: String, isPro: Boolean, freeRemaining: Int ->
      ChatEntitlement.configure(context, apiUrl, installId, isPro, freeRemaining)
    }
  }

  companion object {
    const val EVENT_CAPTURE = "onCapture"

    /**
     * The live module, or null when no React context exists.
     *
     * The service runs with or without JS, so it cannot hold a reference to
     * something that may not be there. Set in OnCreate, cleared in OnDestroy;
     * `notifyCapture` is a no-op whenever JS is absent, which is the normal case
     * on a cold capture and is exactly why the pull path still exists.
     */
    @Volatile
    private var instance: ProfileCaptureModule? = null

    /** Tell JS a capture landed. Safe from any thread, and safe when JS is dead. */
    fun notifyCapture() {
      val module = instance ?: return
      runCatching { module.sendEvent(EVENT_CAPTURE, mapOf<String, Any>()) }
    }
  }

  private fun isAccessibilityEnabled(ctx: Context): Boolean {
    // Settings.Secure is the only reliable read — the service object may not exist
    // yet even when the user has granted it.
    val expected = "${ctx.packageName}/${RizzAccessibilityService::class.java.name}"
    val enabled = Settings.Secure.getString(
      ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':').apply { setString(enabled) }
    for (entry in splitter) {
      if (entry.equals(expected, ignoreCase = true)) return true
    }
    return false
  }
}
