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
      RizzAccessibilityService.ENABLED = enabled
      if (!enabled) CaptureStore.clear()
      enabled
    }

    Function("isEnabled") { RizzAccessibilityService.ENABLED }

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
    Function("configureChat") { apiKey: String, isPro: Boolean, freeRemaining: Int ->
      ChatEntitlement.configure(context, apiKey, isPro, freeRemaining)
    }

    /**
     * Number of free credits the inline chat path burned since the last call, then
     * reset. JS folds this into `analysisCount` so the shared lifetime limit stays
     * correct across all tools.
     */
    Function("consumeChatUsage") { ChatEntitlement.consumePending(context) }
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
