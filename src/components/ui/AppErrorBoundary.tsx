import Ionicons from '@expo/vector-icons/Ionicons';
import type { ErrorBoundaryProps } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { reportError } from '@/services/analytics';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';
import { HapticPressable } from './HapticPressable';

/**
 * What the user sees when a screen throws during render.
 *
 * ## Why this exists
 *
 * There was no error boundary anywhere in the app. Expo Router supports one per
 * route — `export function ErrorBoundary` from any layout — and nothing exported
 * it, so a render-phase throw unmounted the entire tree to a white screen with
 * no way back except force-quitting. The app renders AI output it does not
 * control: a `result.replies.map` on a shape the model got wrong, a null in
 * restored `scanHistory`, a bad `background` key from the feed. Any of those is
 * a dead app rather than a bad card.
 *
 * It was worse than that in combination: `services/analytics.ts` no-ops unless
 * the build had `GOOGLE_SERVICES_JSON`, so a crash was unrecoverable AND
 * invisible at the same time. `reportError` below is why this file imports it —
 * once Crashlytics is configured, every boundary hit lands there with its stack.
 *
 * ## Where it is mounted, and why twice
 *
 * `app/_layout.tsx` — catches everything, including a throw in the auth gate,
 * which is the one screen with no other route to fall back to.
 *
 * `app/(tabs)/_layout.tsx` — catches inside the tab tree, so a broken report on
 * Profile Scan leaves the tab bar and the other three tools usable. Expo Router
 * uses the NEAREST boundary, so this one wins for anything under `(tabs)`.
 *
 * ## Deliberately plain
 *
 * No animation, no `useToast`, no store read, no `expo-image`. Everything this
 * renders has to work in a tree that has already failed once — a boundary that
 * throws is a crash with extra steps.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();

  /*
   * Reported on mount, not in a `useEffect` with the error in its deps: this
   * component is mounted once per failure, so mount IS the failure. `void`
   * because a report must never delay or block the recovery UI.
   */
  React.useEffect(() => {
    reportError(error, 'error_boundary');
  }, [error]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.xxxl,
          paddingBottom: insets.bottom + spacing.xxl,
          paddingHorizontal: gutter,
        },
      ]}
    >
      <View style={styles.badge}>
        <Ionicons name="alert-circle-outline" size={30} color={palette.ember} />
      </View>

      <Text style={styles.title} maxFontSizeMultiplier={1.25}>
        That broke. Not your fault.
      </Text>
      <Text style={styles.body}>
        Something went wrong rendering this screen. Nothing you saved is lost — your vault,
        credits and Pro status live on your account.
      </Text>

      <HapticPressable
        onPress={() => {
          haptic.medium();
          void retry();
        }}
        accessibilityLabel="Try again"
        style={styles.cta}
      >
        <Ionicons name="refresh" size={17} color={palette.ink} />
        <Text style={styles.ctaText}>Try again</Text>
      </HapticPressable>

      {/*
        The message, but only in development.

        In a release build this is a stack trace shown to a stranger — it names
        internal modules, and this app's error strings can quote model output.
        In development it is the difference between fixing the bug and reproducing
        it by hand. `__DEV__` is compile-time, so the branch is stripped from the
        production bundle entirely.
      */}
      {__DEV__ && (
        <View style={styles.devBox}>
          <Text style={styles.devLabel}>DEV ONLY</Text>
          <Text style={styles.devText}>{error.message}</Text>
          {error.stack != null && <Text style={styles.devStack}>{error.stack}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.ember}1F`,
    borderWidth: 1,
    borderColor: `${palette.ember}55`,
    marginBottom: spacing.xs,
  },
  title: {
    ...typo.h1,
    fontWeight: '900',
    textAlign: 'center',
  },
  body: {
    ...typo.bodyMuted,
    textAlign: 'center',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: 15,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.full,
    backgroundColor: palette.violetBright,
  },
  ctaText: { ...typo.body, fontWeight: '900', color: palette.ink },
  devBox: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  devLabel: { ...typo.micro, color: palette.gold },
  devText: { ...typo.label, fontWeight: '700' },
  devStack: { ...typo.micro, fontWeight: '400', letterSpacing: 0, color: palette.textTertiary },
});
