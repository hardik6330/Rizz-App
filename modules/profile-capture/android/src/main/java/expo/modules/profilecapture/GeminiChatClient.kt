package expo.modules.profilecapture

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The inline reply generator — a native mirror of `src/services/gemini.ts` +
 * `engine.ts`, for the one path where JS is not in the loop.
 *
 * The chat bubble runs while RizzCoach's React context may not exist, and the
 * chosen product flow never leaves the host app. So unlike the profile bubble
 * (which hands a screenshot to JS), this must call Gemini itself and drop the reply
 * on the clipboard. That means a second, deliberately faithful copy of the request
 * shape lives here.
 *
 * NON-NEGOTIABLE, kept identical to gemini.ts:
 *  - `thinkingConfig.thinkingLevel = "low"`. gemini-flash-latest is a thinking model
 *    and thinking tokens count against maxOutputTokens; leave it on and the JSON
 *    comes back truncated. This is the exact bug AGENTS.md warns about. It read
 *    `thinkingBudget = 0` until the alias rolled to Gemini 3, which rejects that
 *    key with HTTP 400 — and this path has no mock fallback, so it was the only
 *    place in the app the outage was visible.
 *  - key in the `x-goog-api-key` header, never the URL.
 *  - `responseMimeType=application/json` + a schema, so the reply parses cleanly.
 *
 * Blocking on purpose: the caller runs it off the main thread. No retry loop — a
 * failure toasts and, crucially, does NOT burn a credit (see the service).
 */
object GeminiChatClient {

  private const val TAG = "RizzChatGemini"

  /** Rolling Flash alias — matches GEMINI_MODEL in gemini.ts. */
  private const val MODEL = "gemini-flash-latest"
  private const val ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent"

  /**
   * Mirrors engine.ts's "replies" instruction, collapsed to the ONE best next line
   * — the product here copies a single reply to the clipboard, not three cards.
   * The rails are engine.ts's, plus a note that the transcript is a rough, possibly
   * mis-tagged accessibility scrape rather than clean data.
   */
  private val SYSTEM = """
    You are RizzCoach, an elite dating-conversation strategist. You are given a rough transcript
    of an ongoing chat, scraped from the screen. Lines are best-effort tagged "them:" (the other
    person) and "you:" (the user); the tagging and ordering may be imperfect, so use judgement.

    Write the SINGLE best next message for the user to send. It must:
    - fit the actual conversation and pick up its most recent thread,
    - sound like a real human under 30 (their casual register, not formal),
    - be charming and move things forward without being creepy, manipulative, sexually explicit,
      or pushy,
    - be one sendable message, no preamble, no quotes, no emoji spam.

    If the other person shows disinterest or asks for space, respect it gracefully instead of
    pushing. If the transcript is unreadable or empty, return a warm, low-key opener that could
    plausibly restart the conversation.
  """.trimIndent()

  data class Result(val reply: String)

  /**
   * Call Gemini and return the best reply, or null on any failure (network, HTTP,
   * block, empty, parse). Null means "do not charge, just toast" upstream.
   */
  fun suggestReply(ctx: Context, transcript: String): Result? {
    val key = ChatEntitlement.apiKey(ctx)
    if (key.isEmpty()) {
      Log.w(TAG, "no api key configured")
      return null
    }

    val body = JSONObject().apply {
      put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", SYSTEM))))
      put(
        "contents",
        JSONArray().put(
          JSONObject()
            .put("role", "user")
            .put(
              "parts",
              JSONArray().put(
                JSONObject().put("text", "Here is the chat so far:\n\n$transcript\n\nWrite the best reply for me to send."),
              ),
            ),
        ),
      )
      put(
        "generationConfig",
        JSONObject().apply {
          put("responseMimeType", "application/json")
          put(
            "responseSchema",
            JSONObject()
              .put("type", "OBJECT")
              .put("required", JSONArray().put("reply"))
              .put("properties", JSONObject().put("reply", JSONObject().put("type", "STRING"))),
          )
          // Counts thinking AND output, and `thinkingLevel: "low"` still thinks.
          // Do NOT raise this to "buy headroom": Gemini 3 sizes thinking as a
          // fraction of the cap, so a full 40-line/4000-char transcript measured
          // thoughts=236/out=26 at 512 but thoughts=404/out=26 at 2048. Raising it
          // buys more thinking, latency and cost for an identical one-line reply.
          put("maxOutputTokens", 512)
          put("temperature", 0.9)
          // Load-bearing — see the class header. Do not remove.
          put("thinkingConfig", JSONObject().put("thinkingLevel", "low"))
        },
      )
    }

    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 10_000
        readTimeout = 20_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        // Key in a header, never the URL.
        setRequestProperty("x-goog-api-key", key)
      }
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      if (code !in 200..299) {
        Log.w(TAG, "gemini http $code: ${raw.take(300)}")
        return null
      }

      val reply = parseReply(raw)
      if (reply.isNullOrBlank()) {
        Log.w(TAG, "no reply in gemini response: ${raw.take(300)}")
        null
      } else {
        Result(reply.trim())
      }
    } catch (e: Exception) {
      Log.w(TAG, "gemini call failed", e)
      null
    } finally {
      conn?.disconnect()
    }
  }

  /** candidates[0].content.parts[*].text -> JSON -> { reply }. Mirrors gemini.ts. */
  private fun parseReply(raw: String): String? {
    val root = JSONObject(raw)
    root.optJSONObject("promptFeedback")?.optString("blockReason")?.takeIf { it.isNotEmpty() }?.let {
      Log.w(TAG, "request blocked: $it")
      return null
    }
    val parts = root
      .optJSONArray("candidates")?.optJSONObject(0)
      ?.optJSONObject("content")?.optJSONArray("parts")
      ?: return null
    val text = buildString {
      for (i in 0 until parts.length()) append(parts.optJSONObject(i)?.optString("text").orEmpty())
    }
    if (text.isBlank()) return null
    return JSONObject(text).optString("reply").takeIf { it.isNotBlank() }
  }
}
