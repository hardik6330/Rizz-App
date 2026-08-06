import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { ProfileCapture, SupportedApp } from '@/types';

/**
 * Accessibility capture — detects profile screens in the supported apps, shows a
 * floating "✨ Analyze" bubble, and captures the screen when the user taps it.
 *
 * Android only, and optional: the module is absent on iOS, on web, and in Expo Go.
 * Every export degrades to a safe no-op there so screens can call these without
 * platform branches. `isSupported` is the one thing UI should gate on.
 *
 * The native side owns detection and capture ONLY. It never decides whether the
 * user has credits — that stays in `useOutOfCredits`. See
 * docs/README.md §6.
 */

interface NativeCapture {
  base64: string;
  app: string;
  uiText: string;
  confidence: number;
  isOwnProfile: boolean;
}

type CaptureEvents = {
  /** A capture landed while JS was alive. Payload-free: pull with `consumePendingCapture`. */
  onCapture: () => void;
};

declare class ProfileCaptureNativeModule extends NativeModule<CaptureEvents> {
  isAccessibilityEnabled(): boolean;
  canDrawOverlays(): boolean;
  isWatching(): boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): boolean;
  openAccessibilitySettings(): void;
  openOverlaySettings(): void;
  diagnose(): Diagnosis;
  hasPendingCapture(): boolean;
  consumePendingCapture(): NativeCapture | null;
  clearPendingCapture(): void;
  configureChat(apiUrl: string, installId: string, isPro: boolean, freeRemaining: number): void;
  consumeChatUsage(): number;
}

// Optional: absent on iOS/web/Expo Go, where every call below no-ops.
const native = requireOptionalNativeModule<ProfileCaptureNativeModule>('ProfileCapture');

/** Android build with the native module present. Gate all UI on this. */
export const isSupported = Platform.OS === 'android' && native != null;

/** Package name → the app label we show and send to the model. */
const APP_NAMES: Record<string, SupportedApp> = {
  'com.instagram.android': 'instagram',
  'com.tinder': 'tinder',
  'com.bumble.app': 'bumble',
  'co.hinge.app': 'hinge',
  'com.facebook.katana': 'facebook-dating',
};

export const permissions = {
  /** Service enabled in Settings → Accessibility. */
  accessibility: (): boolean => native?.isAccessibilityEnabled() ?? false,
  /** Allowed to draw the bubble over other apps. */
  overlay: (): boolean => native?.canDrawOverlays() ?? false,
  openAccessibilitySettings: (): void => native?.openAccessibilitySettings(),
  openOverlaySettings: (): void => native?.openOverlaySettings(),
};

/**
 * Both permissions granted AND the in-app switch on. Granting accessibility in
 * Settings must never by itself mean "watching my screen".
 */
export function isWatching(): boolean {
  return native?.isWatching() ?? false;
}

export function isEnabled(): boolean {
  return native?.isEnabled() ?? false;
}

/** The four bits behind `isWatching`, separately. See `serviceKilled` below. */
export interface Diagnosis {
  /** Granted in Settings → Accessibility. */
  accessibility: boolean;
  /** Allowed to draw over other apps. */
  overlay: boolean;
  /** The in-app kill switch. */
  enabled: boolean;
  /** The system currently has our service bound. */
  running: boolean;
}

export function diagnose(): Diagnosis {
  return (
    native?.diagnose() ?? { accessibility: false, overlay: false, enabled: false, running: false }
  );
}

/**
 * Granted in Settings, but no service bound — the OS killed us and did not
 * rebind.
 *
 * This is what MIUI, ColorOS and FuntouchOS do when the app is swiped out of
 * recents, and it is the single most common way this feature dies in the field.
 * It is NOT recoverable from inside the app: only toggling the service off and on
 * in Settings brings it back, so it needs its own copy rather than the generic
 * "turn the analyzer on" prompt, which points at a switch that is already on.
 */
export function serviceKilled(): boolean {
  const d = diagnose();
  return d.accessibility && d.enabled && !d.running;
}

/** The in-app kill switch. Returns the resulting state. */
export function setEnabled(enabled: boolean): boolean {
  return native?.setEnabled(enabled) ?? false;
}

function readNative(): ProfileCapture | null {
  const capture = native?.consumePendingCapture();
  if (!capture) return null;
  return {
    images: [{ base64: capture.base64, mimeType: 'image/jpeg' }],
    app: APP_NAMES[capture.app],
    uiText: capture.uiText || undefined,
    confidence: capture.confidence,
    // The bubble shows on ANY profile, including your own — and the two want
    // opposite reports. Analyzing your own profile in 'them' mode makes the model
    // (correctly) refuse to write openers about you, which reads as a broken app.
    mode: capture.isOwnProfile ? 'self' : 'them',
  };
}

/**
 * Is a capture waiting? Genuinely non-destructive — it stays in the native store.
 *
 * This used to consume the capture and park it in a JS module variable, which
 * made every caller a taker whether it wanted to be or not. The root layout asks
 * this before the Profile Scan tab exists, so the capture spent that window
 * living in a `let` — and a bundle reload, a JS crash or an OTA update threw away
 * a screenshot the user had already taken and could not get back without walking
 * to the other app and tapping again. One owner: the native store, until a screen
 * actually takes it.
 */
export function hasPendingCapture(): boolean {
  return native?.hasPendingCapture() ?? false;
}

/**
 * Take the capture the bubble produced, clearing it. Call on mount, on resume and
 * on focus.
 *
 * Pull rather than push was the original design, because the service runs when
 * the React context may not exist. That is still true and still the primary path
 * — `addCaptureListener` below is the second half, for the case where JS IS alive
 * and therefore never gets a resume to hang the pull off.
 */
export function consumePendingCapture(): ProfileCapture | null {
  return readNative();
}

export function clearPendingCapture(): void {
  native?.clearPendingCapture();
}

/**
 * Fires when a capture lands while this JS context is running.
 *
 * Covers the one case the resume pull cannot: the app is already foreground on a
 * modal, the service brings the task forward, and AppState never leaves 'active'
 * — so nothing tells JS to look. Returns an unsubscribe, or a no-op off Android.
 */
export function addCaptureListener(onCapture: () => void): () => void {
  const sub = native?.addListener('onCapture', onCapture);
  return () => sub?.remove();
}

// ---------------------------------------------------------------------------
// Inline chat reply — entitlement + usage bridge
//
// The chat bubble generates a reply natively and copies it to the clipboard, so
// unlike the profile flow there is no app launch where JS can apply the freemium
// rule. Instead JS pushes an identity + credit SNAPSHOT down (`configureChat`) and
// the native side calls the same `/v1/ai/chat` route the app would. The rule itself
// lives on the server now; this snapshot only gates the tap instantly and offline.
// Both no-op off Android.
// ---------------------------------------------------------------------------

/**
 * Push the API base URL, the anonymous install id and the entitlement snapshot to
 * the native service. Call on launch and every resume so the native cache cannot
 * go stale.
 *
 * The install id rather than an access token: the bubble fires days after the app
 * was last opened, by which time a 24h token is dead. The id never expires, so
 * the service mints its own token when it needs one.
 *
 * This used to carry the Gemini API key. It does not any more — nothing native
 * can call Google.
 */
export function configureChat(
  apiUrl: string,
  installId: string,
  isPro: boolean,
  freeRemaining: number,
): void {
  native?.configureChat(apiUrl, installId, isPro, freeRemaining);
}

/**
 * Free credits the inline chat path has burned since the last call, cleared on read.
 * Fold the returned count into `analysisCount` so the shared lifetime limit stays
 * accurate. Returns 0 off Android or when nothing was used.
 */
export function consumeChatUsage(): number {
  return native?.consumeChatUsage() ?? 0;
}
