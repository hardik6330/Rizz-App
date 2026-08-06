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
import { AuthError, deleteAccount, isLiveApi, logIn, logOut, signUp } from '@/state/session';
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
  const [mode, setMode] = useState<Mode>(initialMode === 'login' ? 'login' : 'signup');
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
  const [isOnboarding] = useState(() => isLiveApi && useRizzStore.getState().account == null);

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
  const [email, setEmail] = useState('');
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
   * The two destructive actions, in the app's own dark sheet rather than
   * `Alert.alert`.
   *
   * The native dialog renders in the platform's light-ish grey with ALL-CAPS
   * buttons, so the one screen where the user is about to do something they
   * cannot undo is the one screen that stops looking like this app.
   *
   * One dialog driven by `confirming`, not two nearly-identical ones: the second
   * copy is where the ✕ stops working, or the busy state is forgotten on the
   * path that actually makes a network call. Still local rather than a shared
   * `<Confirm>` — these are the only two callers in the app.
   */
  const [confirming, setConfirming] = useState<'signout' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState(false);

  const doSignOut = () => {
    setConfirming(null);
    logOut();
    close();
  };

  /**
   * Irreversible, and required to ship.
   *
   * App Store Review 5.1.1(v) requires in-app deletion for any app that lets a
   * user create an account, and Play requires a deletion path too. Signup is
   * mandatory here, so every install creates one — shipping without this is not
   * a risk, it is a rejection.
   *
   * The server does the whole job in one statement because the schema holds no
   * images, transcripts or saved items; the user row IS the user's data.
   */
  const doDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteAccount();
      haptic.success();
      setConfirming(null);
      close();
    } catch (err) {
      haptic.warning();
      setConfirming(null);
      // Surfaced on the screen behind, not swallowed — a delete that silently
      // did nothing is how somebody submits a data request instead.
      setError(err instanceof AuthError ? err.message : 'Could not delete the account — try again');
    } finally {
      setDeleting(false);
    }
  };

  /** Copy and behaviour for whichever confirmation is open. */
  const dialog =
    confirming === 'delete'
      ? {
          title: 'Delete account?',
          // Names every consequence. "This cannot be undone" on its own does not
          // tell somebody that their subscription is not what is being cancelled.
          body: 'This erases your account, your credits and your Pro status permanently. It cannot be undone, and it does not cancel a subscription — do that in the App Store or Play Store.',
          cta: 'Delete',
          onConfirm: doDelete,
        }
      : {
          title: 'Sign out?',
          body: "You'll need your email and password to get back in. There's no password reset yet.",
          cta: 'Sign out',
          onConfirm: doSignOut,
        };

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
          <SignedIn
            username={signedInAs}
            onSignOut={() => {
              haptic.light();
              setConfirming('signout');
            }}
            onDelete={() => {
              haptic.warning();
              setConfirming('delete');
            }}
          />
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
        visible={confirming != null}
        transparent
        animationType="fade"
        statusBarTranslucent
        // Not dismissible mid-delete: the request is already in flight and the
        // account may be gone by the time the sheet closes.
        onRequestClose={() => !deleting && setConfirming(null)}
      >
        <Pressable
          style={styles.scrim}
          accessibilityLabel="Dismiss"
          onPress={() => !deleting && setConfirming(null)}
        >
          {/* Swallows taps so a press inside the card does not dismiss it. */}
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>{dialog.title}</Text>
            <Text style={styles.dialogBody}>{dialog.body}</Text>
            <View style={styles.dialogActions}>
              <HapticPressable
                onPress={() => setConfirming(null)}
                disabled={deleting}
                accessibilityLabel="Cancel"
                style={[styles.dialogGhost, deleting && styles.dialogDisabled]}
              >
                <Text style={styles.dialogGhostText}>Cancel</Text>
              </HapticPressable>
              <HapticPressable
                onPress={dialog.onConfirm}
                disabled={deleting}
                accessibilityLabel={`Confirm ${dialog.cta}`}
                style={styles.dialogDanger}
              >
                {deleting ? (
                  <ActivityIndicator color={palette.danger} size="small" />
                ) : (
                  <Text style={styles.dialogDangerText}>{dialog.cta}</Text>
                )}
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
 * ⚠️ The delete row is REQUIRED. Do not remove it again.
 *
 * App Store Review 5.1.1(v) requires an app that lets a user CREATE an account
 * to let them delete it from inside the app, and Play requires a deletion path
 * too. Signup is mandatory in this product, so every install creates an account
 * — which makes its absence a certain rejection rather than a risk. It was
 * pulled once and `DELETE /v1/user/me` sat here working with no caller.
 *
 * Styled quieter than Sign out, not louder: it is the rarer action and the
 * unrecoverable one, so it should take deliberation to reach, not attract the
 * thumb. The confirmation is where the weight belongs.
 */
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

      <HapticPressable
        onPress={onDelete}
        accessibilityLabel="Delete account"
        accessibilityHint="Permanently erases your account, credits and Pro status"
        style={styles.destructive}
      >
        <Text style={styles.destructiveText}>Delete account</Text>
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
  dialogDisabled: { opacity: 0.4 },

  // Text only, no fill and no border. Reachable, but it does not compete with
  // Sign out for the thumb — the confirmation carries the weight, not this.
  destructive: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  destructiveText: { fontSize: 13.5, fontWeight: '600', color: palette.danger },
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
