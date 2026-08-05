import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
import { palette, radii, spacing } from '@/theme/tokens';
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

  const { mode: initialMode, onboarding } = useLocalSearchParams<{
    mode?: Mode;
    onboarding?: string;
  }>();
  const [mode, setMode] = useState<Mode>(initialMode === 'login' ? 'login' : 'signup');
  /**
   * Reached from the first-run sequence rather than the Profile Scan row.
   *
   * Read once: `setSeenAuth()` flips the store the moment this screen is
   * dismissed, and the copy must not change under the user mid-signup. Same
   * pattern as `firstRun` in analyzer.tsx.
   */
  const [isOnboarding] = useState(() => onboarding === '1');
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
   * Swallow Android hardware back while the gate is up.
   *
   * `gestureEnabled: false` below stops the iOS swipe-to-dismiss, but Android
   * back pops the modal regardless and would drop the user into the app with no
   * account — which is the one state this gate exists to prevent. Same mechanism
   * as useBackToIdle; returning true consumes the press.
   */
  useFocusEffect(
    useCallback(() => {
      if (!isOnboarding) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
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
      // the launch gate. Hand straight back rather than parking on the signed-in
      // view — the analyzer step is waiting behind this modal.
      if (isOnboarding) {
        router.back();
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

  const confirmSignOut = () => {
    haptic.light();
    Alert.alert(
      'Sign out?',
      // Load-bearing: with no reset flow, signing out without knowing the
      // password is how an account is lost for good.
      "You'll need your email and password to get back in. There's no password reset yet.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            logOut();
            close();
          },
        },
      ],
    );
  };

  const confirmDelete = () => {
    haptic.warning();
    Alert.alert(
      'Delete account?',
      'This erases your account and credit balance permanently. It cannot be undone. An active Pro subscription can still be restored on the paywall.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteAccount()
              .then(close)
              .catch(() => toast.show('Could not delete the account — try again'));
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      {/* Stops the iOS swipe-to-dismiss on the mandatory gate. Android back is
          handled by the BackHandler above; the two are separate mechanisms. */}
      <Stack.Screen options={{ gestureEnabled: !isOnboarding }} />
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

      <HapticPressable onPress={onDelete} accessibilityLabel="Delete account" style={styles.danger}>
        <Ionicons name="trash-outline" size={16} color={palette.danger} />
        <Text style={styles.dangerText}>Delete account</Text>
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
  danger: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: spacing.md },
  dangerText: { fontSize: 13.5, fontWeight: '700', color: palette.danger },
});
