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
 * docs/profile-analyzer-blueprint.md §4.7.
 */

interface NativeCapture {
  base64: string;
  app: string;
  uiText: string;
  confidence: number;
  isOwnProfile: boolean;
}

declare class ProfileCaptureNativeModule extends NativeModule {
  isAccessibilityEnabled(): boolean;
  canDrawOverlays(): boolean;
  isWatching(): boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): boolean;
  openAccessibilitySettings(): void;
  openOverlaySettings(): void;
  consumePendingCapture(): NativeCapture | null;
  clearPendingCapture(): void;
  configureChat(apiKey: string, isPro: boolean, freeRemaining: number): void;
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

/** The in-app kill switch. Returns the resulting state. */
export function setEnabled(enabled: boolean): boolean {
  return native?.setEnabled(enabled) ?? false;
}

/**
 * JS-side holder for a capture that has been pulled off the native store but not
 * yet handed to a screen.
 *
 * The native read is destructive (it clears CaptureStore), and the root layout
 * has to ask "is one waiting?" BEFORE the Profile Scan tab exists — the app lands
 * on the Lab tab, so without this the root's peek would consume the capture and
 * the screen that actually renders it would find nothing.
 */
let cached: ProfileCapture | null = null;

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

/** Is a capture waiting? Non-destructive — safe to call from the root layout. */
export function hasPendingCapture(): boolean {
  if (!cached) cached = readNative();
  return cached != null;
}

/**
 * Take the capture the bubble produced, clearing it. Call on mount and on resume.
 *
 * Pull rather than push: the service runs when the React context may not exist,
 * so there is often nothing to push an event to.
 */
export function consumePendingCapture(): ProfileCapture | null {
  const capture = cached ?? readNative();
  cached = null;
  return capture;
}

export function clearPendingCapture(): void {
  native?.clearPendingCapture();
}

// ---------------------------------------------------------------------------
// Inline chat reply — entitlement + usage bridge
//
// The chat bubble generates a reply natively and copies it to the clipboard, so
// unlike the profile flow there is no app launch where JS can apply the freemium
// rule. Instead JS pushes a credit/key SNAPSHOT down (`configureChat`) and drains
// the usage the native side accrued (`consumeChatUsage`). The rule itself stays in
// JS — see `useOutOfCredits` and `state/limits.ts`. Both no-op off Android.
// ---------------------------------------------------------------------------

/**
 * Push the current entitlement snapshot + Gemini key to the native service. Call on
 * launch and every resume so the native cache can never go stale. `freeRemaining`
 * is the JS-owned free-credit balance (large when Pro).
 */
export function configureChat(apiKey: string, isPro: boolean, freeRemaining: number): void {
  native?.configureChat(apiKey, isPro, freeRemaining);
}

/**
 * Free credits the inline chat path has burned since the last call, cleared on read.
 * Fold the returned count into `analysisCount` so the shared lifetime limit stays
 * accurate. Returns 0 off Android or when nothing was used.
 */
export function consumeChatUsage(): number {
  return native?.consumeChatUsage() ?? 0;
}
