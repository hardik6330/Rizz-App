import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthForm } from '@/components/feature/AuthForm';
import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { SignedInPanel } from '@/components/feature/SignedInPanel';
import { useToast } from '@/components/ui/Toast';
import { useAuthForm } from '@/hooks/useAuthForm';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { track } from '@/services/analytics';
import { isLiveApi } from '@/services/auth';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing } from '@/theme/tokens';

/**
 * Signup, login and the signed-in account view — one route, three states.
 *
 * This screen decides WHICH of the three is showing and owns the launch gate
 * around them. The states themselves live elsewhere: `useAuthForm` +
 * `AuthForm` are the signup/login machine and its rendering, `SignedInPanel`
 * is the signed-in view with its two destructive confirmations. It used to be
 * all of it in one 889-line component with sixteen `useState` calls, where the
 * gate logic was impossible to read apart from the form.
 *
 * One route rather than three because the forms differ by a single field and the
 * three states are the same object at different points in its life. The emailed
 * code is a STEP inside the form, not a route, so going back to the details is
 * `setStep('form')` and nothing else — a second screen would have meant carrying
 * an unsubmitted password across a navigation.
 *
 * Why an account exists at all: the install id lives in MMKV and MMKV dies with
 * the app, so an uninstall used to hand out three fresh free analyses. Signing
 * up attaches the account to the row this install already owns, and logging in
 * after a reinstall returns that same row — spent credits, Pro and all.
 */
export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const toast = useToast();
  /** Android has no keyboard handling of its own here — see the hook. */
  const kbInset = useKeyboardInset();

  /**
   * Is this the mandatory launch gate, or the modal from the Profile Scan row?
   *
   * The same condition `_layout.tsx` guards the app on, asked directly of the
   * store. It used to be an `?onboarding=1` param on a push — but there is no
   * push any more: with no account, `(tabs)` is not declared and this screen IS
   * the app, so nothing is left to pass a param.
   *
   * Read once: signing up flips `account` the instant it succeeds, and the copy
   * must not change under the user mid-signup — nor may this turn into a
   * dismissible modal in the frame before the tabs mount. Same pattern as
   * `firstRun` in analyzer.tsx.
   */
  const [isOnboarding, setIsOnboarding] = useState(
    () => isLiveApi && useRizzStore.getState().account == null,
  );

  const form = useAuthForm({ isOnboarding, showToast: toast.show });
  const { step, backToForm, returning } = form;

  /** The store owns this — it re-renders the launch gate the instant it changes. */
  const signedInAs = useRizzStore((s) => s.account);

  /**
   * Lift the splash `_layout.tsx` is holding, now that this screen has rendered.
   *
   * Hiding it there instead would uncover whatever the navigator had painted at
   * that moment. Waiting for the real gate to mount is the only version with no
   * timing guess in it.
   */
  useEffect(() => {
    if (!isOnboarding) return;
    void SplashScreen.hideAsync().catch(() => {});
    /*
     * The denominator of the whole activation funnel.
     *
     * This screen is the app for anyone without an account, so every install
     * that does not convert dies here — and until now that was an unmeasured
     * number. `returning` separates a cold install from someone who signed out
     * and is coming back, because mixing the two flatters the conversion rate
     * with people who already decided months ago.
     *
     * Inside the `isOnboarding` branch on purpose: opened as a modal from the
     * Profile Scan row this is not a gate, and counting it would inflate the
     * denominator with users who are already past it.
     */
    track({ name: 'gate_seen', returning });
    // `returning` is frozen at mount, so this fires once per gate presentation.
  }, [isOnboarding, returning]);

  /**
   * Leave. Only reachable when this is NOT the mandatory launch gate — from the
   * account row on Profile Scan, or after signing out.
   */
  const close = useCallback(() => router.back(), []);

  /*
   * Android hardware back EXITS the app while the gate is up.
   *
   * The default pop would drop the user into the app with no account — the one
   * state this gate exists to prevent — so it cannot be left alone. Swallowing
   * it outright is worse though: a screen where the phone's back button does
   * nothing at all reads as a frozen app, and it is the single most common
   * one-star review for a login wall.
   *
   * So back behaves the way it does on any root screen: it leaves. The gate is
   * still not bypassable — reopening lands straight back here — but the user is
   * never trapped. `exitApp()` is Android-only; iOS has no hardware back, and
   * the swipe-to-dismiss is stopped by `gestureEnabled: false` in the layout.
   *
   * Returning true after exitApp() stops the navigator also popping the modal in
   * the frame before the process goes away.
   *
   * The code step is the exception, and it is registered even when this ISN'T the
   * gate: to an Android user the code screen looks like a second screen, so back
   * means "back to the details". Without this it means either "quit the app"
   * (gate) or "dismiss the modal" (from Profile Scan) — both of which throw away
   * a filled-in form and a code already sitting in the user's inbox, for a tap
   * that reads as a correction.
   */
  useFocusEffect(
    useCallback(() => {
      if (!isOnboarding && step !== 'code') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (step === 'code') {
          backToForm();
          return true;
        }
        BackHandler.exitApp();
        return true;
      });
      return () => sub.remove();
    }, [backToForm, isOnboarding, step]),
  );

  /**
   * Sign-out re-arms the mandatory gate.
   *
   * `isOnboarding` is frozen at mount so the copy cannot change under someone
   * mid-signup — but sign-out is exactly the case where it MUST change. Opened
   * from the Profile Scan row it froze `false`, so after signing out the screen
   * kept a ✕ that closes to nothing and let Android back walk into an app with no
   * account. One-way on purpose: false → true only, never back.
   */
  useEffect(() => {
    if (isLiveApi && signedInAs == null) {
      const handle = requestAnimationFrame(() => {
        setIsOnboarding(true);
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [signedInAs]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            // Full-screen modal on Android; iOS sheets report 0 here.
            paddingTop: insets.top + spacing.lg,
            /*
             * The keyboard's height is added, not assumed away.
             *
             * The password field is the last thing on the page, so with no extra
             * room the content ends exactly where the keyboard begins and there
             * is nothing to scroll to — the field simply stays covered. This
             * gives the ScrollView somewhere to go, and the platform's own
             * reveal-the-focused-input behaviour walks it there.
             *
             * `insets.bottom` is dropped while the keyboard is up: the gesture
             * bar is behind the keyboard, so paying for it twice leaves a gap.
             */
            paddingBottom: (kbInset > 0 ? kbInset : insets.bottom) + spacing.xxxl,
          },
        ]}
        // iOS ONLY — it does nothing on Android, which is why `kbInset` above
        // exists. Kept because on iOS it tracks the keyboard's own animation
        // curve, which the padding alone cannot.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.wordmark}>
            <Ionicons name="person-circle-outline" size={20} color={palette.violet} />
            <Text style={styles.wordmarkText}>Account</Text>
          </View>
          {/* No ✕ while this is the launch gate — there is nothing to close to. */}
          {!isOnboarding && (
            <CircleIconButton icon="close" size={38} onPress={close} accessibilityLabel="Close" />
          )}
        </View>

        {/* `&& !isOnboarding`: as the gate, a successful auth flips `account` in
            the store several frames before `router.replace('/')` can finish —
            `(tabs)` has to be declared and mounted first. Without the guard this
            branch renders in that gap and the user watches a Sign out screen
            spring in on their way into the app. The form stays put instead, CTA
            still spinning (see the early return in `submit`). */}
        {signedInAs != null && !isOnboarding ? (
          <SignedInPanel username={signedInAs} showToast={toast.show} />
        ) : !isLiveApi ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Accounts need a connection to RizzCoach. This build is running on offline demo data.
            </Text>
          </View>
        ) : (
          <AuthForm form={form} isOnboarding={isOnboarding} />
        )}
      </ScrollView>
      {toast.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  scroll: { gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmarkText: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, color: palette.textPrimary },

  notice: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  noticeText: { fontSize: 13.5, lineHeight: 20, color: palette.textSecondary },
});
