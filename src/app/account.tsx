import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CodeStep, CredentialFields } from '@/components/AuthFields';
import { CircleIconButton } from '@/components/CircleIconButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HapticPressable } from '@/components/HapticPressable';
import { useToast } from '@/components/Toast';
import {
  AuthError,
  deleteAccount,
  isLiveApi,
  lastAccountEmail,
  logIn,
  logInWithCode,
  logOut,
  requestOtp,
  signUp,
} from '@/state/session';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';
import { useKeyboardInset } from '@/utils/useKeyboardInset';

/**
 * Signup, login and the signed-in account view — one screen, three states.
 *
 * Two of those states are now two STEPS: details, then the six-digit code we
 * emailed. Still one file. The code step is the same four styles and the same
 * submit path with a different field in it, and splitting it into a route would
 * mean carrying an unsubmitted password across a navigation.
 *
 * One file rather than three routes because the forms differ by a single field
 * and the three states are the same object at different points in its life. It
 * also means there is exactly one place the auth copy lives, which matters more
 * than usual here: this product still has **no password reset**. What it has is
 * a mailed code that logs you in without one, and both halves of that have to be
 * said where the user goes looking — on the signup warning and on the login form.
 *
 * Why an account exists at all: the install id lives in MMKV and MMKV dies with
 * the app, so an uninstall used to hand out three fresh free analyses. Signing
 * up attaches the account to the row this install already owns, and logging in
 * after a reinstall returns that same row — spent credits, Pro and all.
 */
type Mode = 'signup' | 'login';

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const toast = useToast();
  /** Android has no keyboard handling of its own here — see the hook. */
  const kbInset = useKeyboardInset();

  const { mode: initialMode } = useLocalSearchParams<{ mode?: Mode }>();
  /**
   * The email this device signed in with last, if any.
   *
   * Read once at mount — it only changes as a result of submitting this form,
   * and re-reading it mid-session would swap the field out from under whoever is
   * typing.
   *
   * It used to justify a banner and a rejection. Now it does one quiet thing:
   * pre-fill the LOGIN field, so a returning user does not have to remember
   * which of their addresses they used here. Never the signup field — see below.
   */
  const [remembered] = useState(lastAccountEmail);
  const [mode, setMode] = useState<Mode>(
    // Remembered → open on Log in, because someone who has signed in on this
    // device before is overwhelmingly likely to be doing it again. A default, not
    // a restriction: the Create account tab is right there and now works. An
    // explicit `?mode=` still wins; it comes from a deliberate tap.
    initialMode === 'login' || (initialMode == null && remembered != null) ? 'login' : 'signup',
  );
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

  /**
   * Lift the splash `_layout.tsx` is holding, now that this screen has rendered.
   *
   * Hiding it there instead would uncover whatever the navigator had painted at
   * that moment. Waiting for the real gate to mount is the only version with no
   * timing guess in it.
   */
  useEffect(() => {
    if (isOnboarding) void SplashScreen.hideAsync().catch(() => {});
  }, [isOnboarding]);
  const [username, setUsername] = useState('');
  /**
   * Pre-filled on LOGIN only, and blank on signup.
   *
   * The remembered address is by definition one that already has an account, so
   * on the signup tab it can only ever be wrong. That used to be a SILENT dead
   * end — `/otp` answered ok without sending, so the user got "check your email"
   * and waited forever — and `EMAIL_TAKEN` has since fixed the silence. Still
   * blank here, because the best version of that error is the one nobody sees.
   */
  const [email, setEmail] = useState(mode === 'login' ? remembered ?? '' : '');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Details, or the code we emailed. One flag rather than a route.
   *
   * The details are still mounted behind it — going back is `setStep('form')`
   * and nothing else, with the password still typed. A second screen would have
   * meant either passing an unsubmitted password through a navigation param or
   * lifting it into the store, and neither is a thing to do with a password.
   */
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  /**
   * Log in with a mailed code instead of the password.
   *
   * The nearest thing this product has to a reset, and the reason the code step
   * is worth its complexity: before it, a forgotten password was an account
   * nobody could recover. Login-only — signup always takes the code path.
   */
  const [useCode, setUseCode] = useState(false);
  /** The store owns this — it re-renders the launch gate the instant it changes. */
  const signedInAs = useRizzStore((s) => s.account);

  const isSignup = mode === 'signup';

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
   * the swipe-to-dismiss is stopped by `gestureEnabled: false` below.
   *
   * Returning true after exitApp() stops the navigator also popping the modal in
   * the frame before the process goes away.
   */
  /*
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
          setStep('form');
          setCode('');
          setError(null);
          return true;
        }
        BackHandler.exitApp();
        return true;
      });
      return () => sub.remove();
    }, [isOnboarding, step]),
  );

  /** Anything typed on one tab is noise on the other, including a half-done code step. */
  const switchMode = (next: Mode) => {
    haptic.selection();
    setMode(next);
    setError(null);
    setStep('form');
    setCode('');
    setUseCode(false);
    /*
     * The remembered address follows the tab, and only ever when the field is
     * untouched. Filling it on Log in saves the returning user the one thing they
     * cannot look up; clearing it on Create account keeps them off the silent
     * dead end described on `email`. Guarded on the value being exactly the
     * remembered one (or empty) so it can never overwrite something typed.
     */
    if (remembered == null) return;
    setEmail((current) => {
      if (next === 'login') return current === '' ? remembered : current;
      return current === remembered ? '' : current;
    });
  };

  /**
   * Does this path end in a code?
   *
   * Signup always does — that is what makes the address real. Login only when
   * the user asked for it, which is the recovery route.
   */
  const wantsCode = isSignup || useCode;

  /** What the one button actually does right now — see the note at its render. */
  const ctaLabel =
    wantsCode && step === 'form'
      ? 'Send code'
      : isSignup
        ? 'Create account'
        : 'Log in';
  const ctaIcon =
    wantsCode && step === 'form' ? 'mail-outline' : isSignup ? 'sparkles' : 'log-in-outline';

  /**
   * The address is real, but it is on the wrong tab.
   *
   * `EMAIL_TAKEN` on signup and `NO_ACCOUNT` on login are the same mistake seen
   * from either side, and the fix is always "you wanted the other tab". Moving
   * there for the user is the whole point of the server naming these cases: the
   * error text alone leaves them to find a tab they have already scrolled past,
   * and re-type an address they just typed.
   *
   * `setMode`, not `switchMode` — that one clears the form and would take the
   * email with it, which is the one thing that must survive this.
   *
   * Returns whether it moved, so the caller knows the code step is off the table.
   */
  const nudgeMode = useCallback((code: string) => {
    if (code !== 'EMAIL_TAKEN' && code !== 'NO_ACCOUNT') return false;
    setMode(code === 'EMAIL_TAKEN' ? 'login' : 'signup');
    setUseCode(false);
    setStep('form');
    setCode('');
    return true;
  }, []);

  /**
   * Send (or resend) the code, and move to the code step.
   *
   * Shared by the CTA and the Resend button. `announce` is set only by Resend:
   * the first send changes the whole screen, which is feedback enough, but a
   * resend leaves the user on the same screen looking at the same field, and a
   * button that appears to do nothing is a button people tap five times.
   *
   * The copy is now a plain "Code sent" — a 2xx from `/otp` means the mail
   * really went out. It used to be hedged ("if that address has an account")
   * because the server answered ok either way; it no longer does.
   */
  const sendCode = useCallback(
    async (announce = false) => {
      const mail = email.trim();
      setBusy(true);
      setError(null);
      try {
        await requestOtp(mail, isSignup ? 'signup' : 'login');
        haptic.success();
        setStep('code');
        if (!announce) return;
        toast.show('Code sent — check your inbox and spam');
      } catch (err) {
        haptic.warning();
        if (err instanceof AuthError) nudgeMode(err.code);
        setError(err instanceof AuthError ? err.message : 'Could not send the code — try again');
      } finally {
        setBusy(false);
      }
    },
    [email, isSignup, nudgeMode, toast],
  );

  const submit = useCallback(async () => {
    if (busy) return;
    setError(null);

    // Client-side mirrors of the server's Zod rules. Without these a rejected
    // field costs a round trip and reads as "the app is broken".
    if (isSignup && !/^[a-z0-9_]{3,32}$/i.test(username.trim())) {
      setError('Username: 3–32 characters, letters, numbers and _ only');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('That email does not look right');
      return;
    }
    if (isSignup && password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    // Only the password paths need one. A code login has no password to check,
    // and demanding one there would shut the recovery route to the exact people
    // it exists for.
    if (!wantsCode && !password) {
      setError('Enter your password');
      return;
    }

    /*
     * Step one of two: the details check out, so mail a code and stop here.
     *
     * Everything typed stays mounted behind the code step, so "wrong email"
     * costs a Back and not a retype.
     */
    if (wantsCode && step === 'form') {
      haptic.medium();
      await sendCode();
      return;
    }

    if (wantsCode && !/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email');
      return;
    }

    haptic.medium();
    setBusy(true);
    try {
      const user = isSignup
        ? await signUp({
            username: username.trim(),
            email: email.trim(),
            password,
            code: code.trim(),
          })
        : useCode
          ? await logInWithCode(email.trim(), code.trim())
          : await logIn(email.trim(), password);
      haptic.success();
      setPassword('');
      setCode('');
      // `signUp`/`logIn` already pushed the username into the store, which flips
      // the launch gate — `(tabs)` exists as of this render. Replace rather than
      // `back()`: as the gate this screen is the root, there is nothing behind
      // it to pop to. Going to the app also clears it from the history, so the
      // analyzer step waiting behind can present over the tabs and not over a
      // signup form the user has already finished with.
      if (isOnboarding) {
        // Returns while still busy, on purpose — the spinner is what the user
        // looks at for the frames the navigator needs, and this screen is going
        // away, so there is nothing left to un-busy.
        router.replace('/');
        return;
      }
      toast.show(isSignup ? 'Account created — your credits are safe now' : 'Welcome back');
    } catch (err) {
      haptic.warning();
      // Same tab nudge as `sendCode`. Reachable here on the password login path,
      // which never touches /otp, and on a signup whose address was claimed in
      // the seconds between the code being sent and this submit.
      if (err instanceof AuthError) nudgeMode(err.code);
      // The server writes these for the user and never quotes what was typed.
      setError(err instanceof AuthError ? err.message : 'Something went wrong — try again');
    }
    // Not `finally`: that also runs on the early return above, which is the one
    // path that must stay busy. A rejected login still lands here.
    setBusy(false);
  }, [busy, code, email, isOnboarding, isSignup, nudgeMode, password, sendCode, step, toast, useCode, username, wantsCode]);

  /**
   * Confirm sign-out in the app's own dark sheet, not `Alert.alert`.
   *
   * The native dialog renders in the platform's light-ish grey with ALL-CAPS
   * buttons, so the one screen where the user is about to do something they
   * cannot undo is the one screen that stops looking like this app.
   *
   * This started as a local component on the grounds that nothing else would
   * ever call it. Four more destructive confirmations later — clear the vault,
   * remove a saved line, forget a scan, delete the account — it is
   * `components/ConfirmDialog.tsx`, and this screen is just a caller.
   */
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const confirmSignOut = () => {
    haptic.light();
    setConfirmingSignOut(true);
  };
  const doSignOut = () => {
    setConfirmingSignOut(false);
    /*
     * No navigation. `logOut()` clears the store's account, which un-guards
     * `Stack.Protected` in _layout.tsx and removes `(tabs)` — this screen IS
     * where the router lands, and it is already here.
     *
     * It used to call `close()`. That popped to a tab tree being torn down in the
     * same commit, so the user saw the app flash past on the way to a gate the
     * router then had to fall back to. The effect below re-arms the gate chrome.
     */
    logOut();
  };

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = () => {
    haptic.light();
    setConfirmingDelete(true);
  };
  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      haptic.success();
      setConfirmingDelete(false);
      toast.show('Account deleted');
    } catch {
      haptic.warning();
      setConfirmingDelete(false);
      toast.show('Could not delete your account — try again');
    } finally {
      setDeleting(false);
    }
  };

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
    if (isLiveApi && signedInAs == null) setIsOnboarding(true);
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
            still spinning (see `finally` in submit). */}
        {signedInAs != null && !isOnboarding ? (
          <SignedIn username={signedInAs} onSignOut={confirmSignOut} onDelete={confirmDelete} />
        ) : !isLiveApi ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Accounts need a connection to RizzCoach. This build is running on offline demo data.
            </Text>
          </View>
        ) : (
          <>
            <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.hero}>
              <Text style={styles.title} maxFontSizeMultiplier={1.25}>
                {step === 'code'
                  ? 'Check your email.'
                  : !isSignup
                    ? 'Welcome back.'
                    : isOnboarding
                      ? 'Welcome to RizzCoach.'
                      : 'Keep your credits.\nWherever you install.'}
              </Text>
              <Text style={styles.body}>
                {step === 'code' ? (
                  <>
                    {/* The address is echoed back because the commonest failure
                        here is a typo the user cannot see any more — the field is
                        a screen behind them. Reading it back turns "no email
                        arrived" into "ah, that's wrong" without a Back tap. */}
                    We sent a 6-digit code to <Text style={styles.strong}>{email.trim()}</Text>. It
                    expires in 10 minutes.
                  </>
                ) : isSignup ? (
                  isOnboarding ? (
                    'Create an account so your free analyses, Pro status and saved lines belong to you — not to this one phone. Already have one? Log in.'
                  ) : (
                    'Your analyses live on this device today. An account moves them to you, so a new phone or a reinstall picks up where you left off.'
                  )
                ) : useCode ? (
                  // A plain string, so the entity has to be the real character —
                  // `&rsquo;` only decodes in JSX text, never inside a literal.
                  'Enter your email and we’ll send you a code. No password needed.'
                ) : (
                  'Log in and your credits, Pro status and history come with you.'
                )}
              </Text>
            </Animated.View>

            {/*
             * REMOVED: the "This device's account is …" banner.
             *
             * It was the last piece of one-device-one-account left in the UI. It
             * existed to get ahead of a server rejection — signup on a claimed
             * install used to fail — and that rejection no longer exists, so all
             * the banner did was assert something untrue: a device can now hold
             * as many accounts as it has verified addresses, and naming one of
             * them "this device's account" tells a second user on a shared phone
             * that the app is not for them.
             *
             * The address is still remembered, and still pre-fills the LOGIN
             * form — see `remembered`. It just no longer has an opinion out loud.
             */}

            {/* Hidden on the code step. Switching tabs there throws away a code
                that is already in the user's inbox and a form they have filled
                in, for a tap they almost certainly meant as "go back". */}
            {step === 'form' && (
            <View style={styles.tabs}>
              {(['signup', 'login'] as const).map((key) => {
                const active = key === mode;
                return (
                  <HapticPressable
                    key={key}
                    feedback="none"
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => switchMode(key)}
                    style={[styles.tab, active && styles.tabActive]}
                  >
                    {/* minWidth 0 + flexShrink + numberOfLines: RN defaults
                        flexShrink to 0, so a long label spills the gutter. */}
                    <Text
                      style={[styles.tabLabel, active && { color: palette.textPrimary }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.2}
                    >
                      {key === 'signup' ? 'Create account' : 'Log in'}
                    </Text>
                  </HapticPressable>
                );
              })}
            </View>
            )}

            {step === 'code' ? (
              <CodeStep
                code={code}
                onCode={setCode}
                busy={busy}
                onSubmit={() => void submit()}
                onBack={() => {
                  setStep('form');
                  setCode('');
                  setError(null);
                }}
                onResend={() => {
                  setCode('');
                  void sendCode(true);
                }}
              />
            ) : (
              <CredentialFields
                isSignup={isSignup}
                useCode={useCode}
                username={username}
                onUsername={setUsername}
                email={email}
                onEmail={setEmail}
                password={password}
                onPassword={setPassword}
                reveal={reveal}
                onToggleReveal={() => setReveal((r) => !r)}
                onToggleUseCode={() => {
                  setUseCode((v) => !v);
                  setError(null);
                }}
                onSubmit={() => void submit()}
              />
            )}


            {error != null && (
              <View style={styles.error} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle-outline" size={15} color={palette.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Three labels from two flags. On the form step of a code path the
                button sends the code and does NOT create anything — calling it
                "Create account" there would be a lie about what the tap does,
                and the moment a user believes the account exists is the moment
                they stop looking for the email. */}
            <HapticPressable
              feedback="none"
              onPress={() => void submit()}
              disabled={busy}
              accessibilityLabel={ctaLabel}
              style={[styles.cta, busy && styles.ctaBusy]}
            >
              {busy ? (
                <ActivityIndicator color={palette.ink} />
              ) : (
                <>
                  <Ionicons name={ctaIcon} size={17} color={palette.ink} />
                  <Text style={styles.ctaText}>{ctaLabel}</Text>
                </>
              )}
            </HapticPressable>

            <Text style={styles.footnote}>
              We store your email and username, and nothing else about you. Screenshots and
              conversations are never saved.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Load-bearing body copy: with no reset flow, signing out without knowing
          the password is how an account is lost for good. */}
      <ConfirmDialog
        visible={confirmingSignOut}
        title="Sign out?"
        body="You’ll need your email and password to get back in. There’s no password reset yet."
        confirmLabel="Sign out"
        onConfirm={doSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete your account?"
        body="This is permanent. Your credits, Pro status, saved lines and all account data will be gone — there is no undo."
        confirmLabel="Delete account"
        busy={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
      {toast.element}
    </View>
  );
}

function SignedIn({
  username,
  onSignOut,
  onDelete,
}: {
  username: string;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.signedIn}>
      <View style={styles.avatar}>
        <Ionicons name="person" size={26} color={palette.violetBright} />
      </View>
      <Text style={styles.signedInName} numberOfLines={1}>
        @{username}
      </Text>
      <Text style={styles.body}>
        Your credits and Pro status follow this account. Log in on a new phone and everything comes
        with you.
      </Text>

      <HapticPressable onPress={onSignOut} accessibilityLabel="Sign out" style={styles.secondary}>
        <Ionicons name="log-out-outline" size={16} color={palette.textSecondary} />
        <Text style={styles.secondaryText}>Sign out</Text>
      </HapticPressable>

      <HapticPressable onPress={onDelete} accessibilityLabel="Delete account" style={styles.deleteBtn}>
        <Ionicons name="trash-outline" size={16} color={palette.danger} />
        <Text style={styles.deleteBtnText}>Delete account</Text>
      </HapticPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  scroll: { gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmarkText: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, color: palette.textPrimary },
  hero: { gap: spacing.sm },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '900', letterSpacing: -0.8, color: palette.textPrimary },
  body: { fontSize: 14.5, lineHeight: 21, color: palette.textSecondary },

  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  tabActive: { backgroundColor: `${palette.violet}24`, borderColor: `${palette.violet}88` },
  tabLabel: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: palette.textSecondary },


  warning: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: `${palette.gold}14`,
    borderWidth: 1,
    borderColor: `${palette.gold}44`,
  },
  warningIcon: { marginTop: 2 },
  warningText: { flex: 1, fontSize: 13, lineHeight: 19, color: palette.textSecondary },
  warningStrong: { fontWeight: '800', color: palette.textPrimary },

  /** Emphasis inside a muted paragraph — the address echoed back on the code step. */
  strong: { fontWeight: '800', color: palette.textPrimary },

  /*
   * Wide tracking and a bigger face: six digits copied off a notification are
   * read back one at a time to check them, and the default 15pt run reads as a
   * number rather than as six separate characters. `center` because there is
   * nothing else on the line to align to.
   */

  /** Text-button row: the secondary actions that are not the CTA. */

  error: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, color: palette.danger },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
    borderRadius: radii.full,
    backgroundColor: palette.violetBright,
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { fontSize: 15.5, fontWeight: '900', color: palette.ink },
  footnote: { fontSize: 12, lineHeight: 17, textAlign: 'center', color: palette.textTertiary },

  notice: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  noticeText: { fontSize: 13.5, lineHeight: 20, color: palette.textSecondary },

  signedIn: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.violet}1F`,
    borderWidth: 1,
    borderColor: `${palette.violet}55`,
  },
  signedInName: { fontSize: 21, fontWeight: '900', letterSpacing: -0.4, color: palette.textPrimary },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    paddingVertical: 14,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  secondaryText: { fontSize: 14.5, fontWeight: '700', color: palette.textSecondary },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,92,92,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,92,92,0.3)',
  },
  deleteBtnText: { fontSize: 14.5, fontWeight: '700', color: palette.danger },

});
