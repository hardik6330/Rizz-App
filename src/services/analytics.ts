import { Platform } from 'react-native';

/**
 * Firebase Analytics + Crashlytics, behind a typed event list.
 *
 * **This takes an event from a fixed union, never a free-form name and payload.**
 * The app transmits screenshots of other people's private conversations, and a
 * `track('thing', { ...body })` at 2am is the mistake everyone eventually makes —
 * it would put a transcript in an analytics warehouse forever, in a different
 * company's jurisdiction, with no delete story. Same rule, same reason, as
 * `backend/src/lib/logger.ts`. There is no overload here that accepts arbitrary
 * data, so the mistake has nowhere to live.
 *
 * NEVER add a parameter carrying: message text, bios, profile names, openers,
 * `uiText`, package names of chats, image bytes, or an install id.
 *
 * Both SDKs are optional at runtime, exactly like `widgetBridge.ts`: the native
 * modules only exist in a build whose config plugin ran, so Expo Go and any
 * build without `google-services.json` quietly no-op. Analytics must never be
 * the reason a screen crashes.
 */

/**
 * `app_open`, `first_open`, `session_start`, `screen_view` and `app_exception`
 * are collected by Firebase automatically — they are RESERVED names and logging
 * them by hand is silently dropped. That covers the "App Open" requirement with
 * no code, so there is deliberately no `appOpen()` here.
 *
 * `pro_purchased` is deliberately NOT named `purchase`: that is a GA4 commerce
 * event expecting `currency`/`value`/`items`, and RevenueCat already reports
 * revenue. Sending a half-populated `purchase` corrupts GA4's revenue model.
 */
export type AnalyticsEvent =
  /** An AI call returned a usable result. `ms` is end-to-end, including transport. */
  | { name: 'ai_success'; engine: EngineName; ms: number }
  /** An AI call failed. `code` is the server's error code — never the message. */
  | { name: 'ai_fail'; engine: EngineName; code: string }
  /** Paywall reached. `source` is which gate sent them, for funnel attribution. */
  | { name: 'paywall_viewed'; source: PaywallSource }
  | { name: 'paywall_dismissed'; source: PaywallSource; converted: boolean }
  /** `mock` is true when RevenueCat had a stub key and Pro was granted for free. */
  | { name: 'pro_purchased'; plan: string; mock: boolean }
  /**
   * A user rated a generated report 👍/👎. The only quality signal this product
   * gets — nothing else tells us whether the output was any good.
   *
   * Carries the engine and the verdict and NOTHING else. Not the report id, not
   * the mode, not a word of the report: the rule above is not relaxed for the one
   * event where the content would be most interesting to have. If a future
   * version needs the text, it needs a consented, deletable store for it — not
   * this pipe.
   */
  | { name: 'report_feedback'; engine: EngineName; value: 'up' | 'down' }
  /** The accessibility funnel — the app's biggest drop-off, and entirely invisible today. */
  | { name: 'a11y_prompt_seen' }
  | { name: 'a11y_settings_opened' }
  | { name: 'a11y_enabled' }
  | { name: 'a11y_disabled'; via: 'app_toggle' | 'bubble_drag' };

export type EngineName = 'lab' | 'profile' | 'bio' | 'feed' | 'chat';
export type PaywallSource = 'out_of_credits' | 'swipe_limit' | 'upsell_card' | 'manual';

type FirebaseAnalytics = {
  logEvent(name: string, params?: Record<string, string | number | boolean>): Promise<void>;
  setUserProperty(name: string, value: string | null): Promise<void>;
};
type FirebaseCrashlytics = {
  recordError(error: Error, jsErrorName?: string): void;
  log(message: string): void;
  setAttribute(name: string, value: string): Promise<void>;
};

/*
 * Two near-identical loaders rather than one `load(moduleName)` helper: Metro
 * resolves `require` at build time from a STRING LITERAL, and a variable
 * argument fails the bundle outright ("Invalid call at line N: require(module)").
 * The duplication is the price of lazy loading in React Native — same reason
 * `widgetBridge.ts` inlines its own require.
 *
 * Firebase is Android/iOS only; this app has no web analytics target.
 */
let analytics: FirebaseAnalytics | null | undefined;
let crashlytics: FirebaseCrashlytics | null | undefined;

function getAnalytics(): FirebaseAnalytics | null {
  if (analytics !== undefined) return analytics;
  analytics = null;
  if (Platform.OS === 'web') return null;
  try {
    const mod = require('@react-native-firebase/analytics') as { default: () => FirebaseAnalytics };
    analytics = mod.default();
  } catch {
    // Native module absent: Expo Go, or a build without google-services.json.
  }
  return analytics;
}

function getCrashlytics(): FirebaseCrashlytics | null {
  if (crashlytics !== undefined) return crashlytics;
  crashlytics = null;
  if (Platform.OS === 'web') return null;
  try {
    const mod = require('@react-native-firebase/crashlytics') as {
      default: () => FirebaseCrashlytics;
    };
    crashlytics = mod.default();
  } catch {
    // Same: absent without the config plugin. Analytics must never crash a screen.
  }
  return crashlytics;
}

/**
 * Record an event. Fire-and-forget and never throws — a rejected logEvent must
 * not turn a completed purchase into an error dialog.
 */
export function track(event: AnalyticsEvent): void {
  const { name, ...params } = event;
  getAnalytics()
    ?.logEvent(name, params as Record<string, string | number | boolean>)
    .catch(() => {
      /* analytics is never worth a user-visible failure */
    });
}

/**
 * Report a caught error to Crashlytics.
 *
 * Every engine swallows failures into a mock fallback so the app demos offline —
 * which means a live outage looks identical to normal use and shows up nowhere.
 * This is what makes that failure visible without changing the UX.
 *
 * `context` must be a fixed string, not interpolated user content.
 */
export function reportError(error: unknown, context: string): void {
  const crash = getCrashlytics();
  if (!crash) return;
  crash.log(context);
  crash.recordError(error instanceof Error ? error : new Error(String(error)), context);
}

/**
 * Pro / free, as a user property so every funnel can be segmented by it.
 *
 * A user property is the only identity-ish thing sent. The install id is NOT
 * sent: it is the bearer credential that owns a user's credits, and Firebase is
 * not a place to put credentials.
 */
export function setProProperty(isPro: boolean): void {
  void getAnalytics()?.setUserProperty('is_pro', String(isPro));
  void getCrashlytics()?.setAttribute('is_pro', String(isPro));
}
