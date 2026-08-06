package expo.modules.profilecapture

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The inline reply generator — now a thin client of the RizzCoach API.
 *
 * The chat bubble runs while RizzCoach's React context may not exist, and the
 * product flow never leaves the host app, so this path cannot go through
 * `services/api.ts`. It makes its own HTTP call. What it no longer does is call
 * Google: **there is no Gemini key in this file, and no prompt.**
 *
 * Both used to live here, a deliberately faithful copy of `gemini.ts` +
 * `engine.ts`. That copy was the reason the Gemini key had to keep shipping
 * inside the APK after the four JS engines had already moved server-side, and it
 * meant the `thinkingLevel` fix and the reply rails existed in two languages that
 * had to be edited together. Both now live once, in `backend/src/ai/`.
 *
 * Identity: the service authenticates itself with the anonymous install id that
 * JS pushed down, because a 24h access token is worthless to a bubble that fires
 * days after the app was last opened. It mints a token, caches it, and retries
 * exactly once on a 401.
 *
 * Blocking on purpose: the caller runs it off the main thread. No retry loop —
 * a failure toasts and, crucially, does NOT burn a credit (the server refunds).
 */
object GeminiChatClient {

  private const val TAG = "RizzChatApi"

  data class Result(val reply: String, val isPro: Boolean, val remaining: Int)

  /**
   * Ask the API for the best reply, or null on any failure (network, HTTP, empty,
   * parse). Null means "do not charge, just toast" upstream — and the server has
   * already refunded its own charge by then.
   */
  fun suggestReply(ctx: Context, transcript: String, tone: String): Result? {
    val base = ChatEntitlement.apiUrl(ctx)
    if (base.isEmpty()) {
      Log.w(TAG, "no api url configured")
      return null
    }

    val body = JSONObject()
      .put("transcript", transcript)
      .put("tone", tone)
      .toString()

    var token = ChatEntitlement.accessToken(ctx)
    if (token.isEmpty()) token = authenticate(ctx, base) ?: return null

    var raw = post(ctx, "$base/v1/ai/chat", body, token)
    // One retry, and only on an expired/invalid token. Anything else is a real
    // failure and retrying it would just double the latency.
    if (raw == null && lastStatus == 401) {
      token = authenticate(ctx, base) ?: return null
      raw = post(ctx, "$base/v1/ai/chat", body, token)
    }
    if (raw == null) return null

    return try {
      val root = JSONObject(raw)
      val reply = root.optString("reply").takeIf { it.isNotBlank() } ?: return null
      val credits = root.optJSONObject("credits")
      Result(
        reply = reply.trim(),
        isPro = credits?.optBoolean("is_pro") ?: false,
        // `remaining` is null for Pro; optInt gives 0, which applyServerCredits
        // ignores because isPro wins.
        remaining = credits?.optInt("remaining") ?: 0,
      )
    } catch (e: Exception) {
      Log.w(TAG, "bad response", e)
      null
    }
  }

  /** HTTP status of the most recent [post], for the 401 retry decision. */
  private var lastStatus = 0

  private fun authenticate(ctx: Context, base: String): String? {
    val installId = ChatEntitlement.installId(ctx)
    val payload = JSONObject().apply {
      // Omitted on a cold install; the server mints one and returns it.
      if (installId.isNotEmpty()) put("install_id", installId)
      put("platform", "android")
    }.toString()

    val raw = post(ctx, "$base/v1/auth/device", payload, null) ?: return null
    return try {
      val token = JSONObject(raw).optString("access_token").takeIf { it.isNotBlank() }
      if (token != null) ChatEntitlement.setAccessToken(ctx, token)
      token
    } catch (e: Exception) {
      Log.w(TAG, "auth parse failed", e)
      null
    }
  }

  private fun post(ctx: Context, url: String, body: String, token: String?): String? {
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 10_000
        /*
         * MUST stay above the server's own abort, which is 45s
         * (`AbortSignal.timeout(45_000)` in backend/src/ai/gateway.ts).
         *
         * At 30s the client gave up FIRST: the server was still generating, went on
         * to charge and then refund a credit, and the user saw "couldn't reach the
         * coach" for a request that was about to succeed. Whoever times out first
         * decides what the user sees, and it should be the side that knows whether
         * the work actually failed. Raise this if the gateway's abort is ever
         * raised, never the other way round.
         */
        readTimeout = 60_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        if (token != null) setRequestProperty("Authorization", "Bearer $token")
      }
      conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

      val code = conn.responseCode
      lastStatus = code
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      if (code !in 200..299) {
        // Log the code, never the body — an error envelope is safe today, but this
        // is the one log line in the service that sees a response to a request
        // containing somebody's private conversation.
        Log.w(TAG, "api http $code for ${URL(url).path}")
        return null
      }
      raw
    } catch (e: Exception) {
      lastStatus = 0
      Log.w(TAG, "api call failed", e)
      null
    } finally {
      conn?.disconnect()
    }
  }
}
