import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleIconButton } from '@/components/CircleIconButton';
import { HapticPressable } from '@/components/HapticPressable';
import { useToast } from '@/components/Toast';
import { AuthError, isLiveApi, lastAccountEmail, logIn, logOut, signUp } from '@/state/session';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing, type as typography } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * Signup, login and the signed-in account view — one screen, three states.
 *
 * One file rather than three routes because the forms differ by a single field
 * and the three states are the same object at different points in its life. It
 * also means there is exactly one place the auth copy lives, which matters more
 * than usual here: this product has **no password reset**, and the warning that
 * says so has to be impossible to miss and impossible to forget to update.
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

  const { mode: initialMode } = useLocalSearchParams<{ mode?: Mode }>();
  /**
   * The email this device signed in with last, if any.
   *
   * Read once at mount — it only changes as a result of submitting this form,
   * and re-reading it mid-session would swap the field out from under whoever is
   * typing. Its whole job is the dead end in the screenshot: signup on a claimed
   * install is rejected by the server, and with no password reset a user who has
   * forgotten which address they used has no way forward at all.
   */
  const [remembered] = useState(lastAccountEmail);
  const [mode, setMode] = useState<Mode>(
    // Remembered → Log in, because signup on this install cannot succeed. An
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
  const [email, setEmail] = useState(remembered ?? '');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  useFocusEffect(
    useCallback(() => {
      if (!isOnboarding) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        BackHandler.exitApp();
        return true;
      });
      return () => sub.remove();
    }, [isOnboarding]),
  );

  const switchMode = (next: Mode) => {
    haptic.selection();
    setMode(next);
    setError(null);
  };

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
    if (!password) {
      setError('Enter your password');
      return;
    }

    haptic.medium();
    setBusy(true);
    try {
      const user = isSignup
        ? await signUp({ username: username.trim(), email: email.trim(), password })
        : await logIn(email.trim(), password);
      haptic.success();
      setPassword('');
      // `signUp`/`logIn` already pushed the username into the store, which flips
      // the launch gate — `(tabs)` exists as of this render. Replace rather than
      // `back()`: as the gate this screen is the root, there is nothing behind
      // it to pop to. Going to the app also clears it from the history, so the
      // analyzer step waiting behind can present over the tabs and not over a
      // signup form the user has already finished with.
      if (isOnboarding) {
        router.replace('/');
        return;
      }
      toast.show(isSignup ? 'Account created — your credits are safe now' : 'Welcome back');
    } catch (err) {
      haptic.warning();
      // The server writes these for the user and never quotes what was typed.
      setError(err instanceof AuthError ? err.message : 'Something went wrong — try again');
    } finally {
      setBusy(false);
    }
  }, [busy, email, isOnboarding, isSignup, password, toast, username]);

  /**
   * Confirm sign-out in the app's own dark sheet, not `Alert.alert`.
   *
   * The native dialog renders in the platform's light-ish grey with ALL-CAPS
   * buttons, so the one screen where the user is about to do something they
   * cannot undo is the one screen that stops looking like this app. Nothing else
   * in the app raises an Alert, so this stays a local component rather than a
   * shared `<Confirm>` nobody else would call.
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
            paddingBottom: insets.bottom + spacing.xxxl,
          },
        ]}
        // The password field is the last thing on the page and iOS covered it
        // outright — same fix, same reason, as bio.tsx.
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

        {signedInAs != null ? (
          <SignedIn username={signedInAs} onSignOut={confirmSignOut} />
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
                {!isSignup
                  ? 'Welcome back.'
                  : isOnboarding
                    ? 'Welcome to RizzCoach.'
                    : 'Keep your credits.\nWherever you install.'}
              </Text>
              <Text style={styles.body}>
                {isSignup
                  ? isOnboarding
                    ? 'Create an account so your free analyses, Pro status and saved lines belong to you — not to this one phone. Already have one? Log in.'
                    : 'Your analyses live on this device today. An account moves them to you, so a new phone or a reinstall picks up where you left off.'
                  : 'Log in and your credits, Pro status and history come with you.'}
              </Text>
            </Animated.View>

            {/* The device knows whose account it is — say so, instead of letting
                the server say "this device already has an account" after the
                user has typed a whole signup form. Tapping it is the fix for the
                one case where it is in the way: signup mode. */}
            {remembered != null && (
              <HapticPressable
                feedback="none"
                disabled={!isSignup}
                onPress={() => switchMode('login')}
                accessibilityRole={isSignup ? 'button' : 'text'}
                style={styles.remembered}
              >
                <Ionicons name="person-circle-outline" size={16} color={palette.violetBright} />
                <Text style={styles.rememberedText}>
                  This device&rsquo;s account is{' '}
                  <Text style={styles.rememberedStrong}>{remembered}</Text>
                  {isSignup ? ' — tap to log in instead.' : '.'}
                </Text>
              </HapticPressable>
            )}

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

            {isSignup && (
              <Field
                label="USERNAME"
                value={username}
                onChangeText={setUsername}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                maxLength={32}
              />
            )}

            <Field
              label="EMAIL"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              maxLength={255}
            />

            <Field
              label="PASSWORD"
              value={password}
              onChangeText={setPassword}
              placeholder={isSignup ? 'At least 10 characters' : 'Your password'}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!reveal}
              // `newPassword` lets the OS keychain offer to generate and save
              // one — the closest thing to a reset flow this version has.
              textContentType={isSignup ? 'newPassword' : 'password'}
              maxLength={128}
              onSubmitEditing={() => void submit()}
              returnKeyType="go"
              accessory={
                <HapticPressable
                  feedback="none"
                  hitSlop={10}
                  onPress={() => setReveal((r) => !r)}
                  accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
                >
                  <Ionicons
                    name={reveal ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={palette.textTertiary}
                  />
                </HapticPressable>
              }
            />

            {isSignup && (
              /*
               * Shown BEFORE the button, not after a failure. There is no
               * password reset: a forgotten password is an account nobody can
               * recover, so the user has to be told while they can still act on
               * it. Delete this paragraph the day /auth/reset ships, not before.
               */
              <View style={styles.warning}>
                <Ionicons name="key-outline" size={15} color={palette.gold} style={styles.warningIcon} />
                <Text style={styles.warningText}>
                  <Text style={styles.warningStrong}>Save your password. </Text>
                  There&apos;s no reset yet — if you lose it you&apos;ll need a new account. Pro can
                  still be restored on the paywall; saved lines and scan history can&apos;t.
                </Text>
              </View>
            )}

            {error != null && (
              <View style={styles.error} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle-outline" size={15} color={palette.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <HapticPressable
              feedback="none"
              onPress={() => void submit()}
              disabled={busy}
              accessibilityLabel={isSignup ? 'Create account' : 'Log in'}
              style={[styles.cta, busy && styles.ctaBusy]}
            >
              {busy ? (
                <ActivityIndicator color={palette.ink} />
              ) : (
                <>
                  <Ionicons name={isSignup ? 'sparkles' : 'log-in-outline'} size={17} color={palette.ink} />
                  <Text style={styles.ctaText}>{isSignup ? 'Create account' : 'Log in'}</Text>
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

      {/* Dismissible by the scrim and by Android back — a confirm the hardware
          back button ignores is the one people hit twice and sign out anyway. */}
      <Modal
        visible={confirmingSignOut}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setConfirmingSignOut(false)}
      >
        <Pressable
          style={styles.scrim}
          accessibilityLabel="Dismiss"
          onPress={() => setConfirmingSignOut(false)}
        >
          {/* Swallows taps so a press inside the card does not dismiss it. */}
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>Sign out?</Text>
            <Text style={styles.dialogBody}>
              {/* Load-bearing: with no reset flow, signing out without knowing the
                  password is how an account is lost for good. */}
              You&rsquo;ll need your email and password to get back in. There&rsquo;s no password
              reset yet.
            </Text>
            <View style={styles.dialogActions}>
              <HapticPressable
                onPress={() => setConfirmingSignOut(false)}
                accessibilityLabel="Cancel"
                style={styles.dialogGhost}
              >
                <Text style={styles.dialogGhostText}>Cancel</Text>
              </HapticPressable>
              <HapticPressable
                onPress={doSignOut}
                accessibilityLabel="Confirm sign out"
                style={styles.dialogDanger}
              >
                <Text style={styles.dialogDangerText}>Sign out</Text>
              </HapticPressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {toast.element}
    </View>
  );
}

/**
 * ⚠️ There is no in-app delete here, by request. This is a KNOWN store risk.
 *
 * App Store Review 5.1.1(v) requires an app that lets a user CREATE an account
 * to let them delete it from inside the app, and Play requires a deletion path
 * too. Signup is mandatory in this product, so every install creates an account
 * — which makes this a certain rejection rather than a risk, unless a web
 * deletion page is linked from somewhere the reviewer can find it.
 *
 * The server side is intact and has no caller: `DELETE /v1/user/me` in
 * routes/user.ts, and `deleteAccount()` in state/session.ts. Restoring the
 * button is a row here plus a branch in the confirm dialog above — a few lines,
 * not a feature. Removed twice now; if it comes back a third time, link the web
 * page instead so this stops being a decision.
 */
function SignedIn({ username, onSignOut }: { username: string; onSignOut: () => void }) {
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
    </Animated.View>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  accessory?: React.ReactNode;
};

function Field({ label, accessory, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          {...input}
          accessibilityLabel={label}
          placeholderTextColor={palette.textTertiary}
          style={styles.input}
        />
        {accessory}
      </View>
    </View>
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

  field: { gap: 7 },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: palette.textTertiary },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  input: { flex: 1, minWidth: 0, paddingVertical: 14, fontSize: 15, color: palette.textPrimary },

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

  remembered: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: `${palette.violet}14`,
    borderWidth: 1,
    borderColor: `${palette.violet}44`,
  },
  rememberedText: { flex: 1, fontSize: 13, lineHeight: 19, color: palette.textSecondary },
  rememberedStrong: { fontWeight: '800', color: palette.textPrimary },

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

  // ── Sign-out confirmation ──────────────────────────────────────────────────
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    // Darker than the app background so the card reads as lifted off it — a
    // surface-coloured sheet on an ink scrim would just look like a panel.
    backgroundColor: 'rgba(3,3,8,0.72)',
  },
  dialog: {
    alignSelf: 'stretch',
    maxWidth: 400,
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  dialogTitle: { ...typography.h2 },
  dialogBody: { ...typography.bodyMuted, fontSize: 14 },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dialogGhost: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
  },
  dialogGhostText: { fontSize: 14.5, fontWeight: '700', color: palette.textSecondary },
  dialogDanger: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    // Tinted rather than solid: destructive, but it is not the action we are
    // steering the user toward, and a solid red fill reads as the primary CTA.
    backgroundColor: 'rgba(255,92,92,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,92,92,0.4)',
  },
  dialogDangerText: { fontSize: 14.5, fontWeight: '700', color: palette.danger },
});
