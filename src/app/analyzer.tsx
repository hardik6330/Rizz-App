import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/CircleIconButton';
import { HapticPressable } from '@/components/HapticPressable';
import { useToast } from '@/components/Toast';
import { useRizzStore } from '@/state/useRizzStore';
import { isSupported, isEnabled, permissions, setEnabled } from '@/../modules/profile-capture';
import { track } from '@/services/analytics';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * Prominent disclosure + permission flow for the accessibility analyzer.
 *
 * This screen IS the compliance surface. It must say, before the user reaches
 * Settings, exactly what is read, when, and what leaves the device. Google review
 * reads it, and so does the user. If the behaviour changes, this copy changes
 * first — see docs/profile-analyzer-blueprint.md §6.
 *
 * Two Settings round-trips (accessibility, then overlay) is a brutal funnel;
 * measure drop-off at each step before optimising anything else here.
 */
export default function AnalyzerScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const toast = useToast();

  const [a11y, setA11y] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [on, setOn] = useState(false);

  const hasOnboarded = useRizzStore((s) => s.hasOnboarded);
  const setOnboarded = useRizzStore((s) => s.setOnboarded);
  /** Read once on mount: the flag flips while this screen is open, and the copy
   *  should not change under the user mid-setup. */
  const [firstRun] = useState(() => !hasOnboarded);

  // Mark on dismissal, not on completion — see the note in _layout.tsx.
  const close = useCallback(() => {
    setOnboarded();
    router.back();
  }, [setOnboarded]);

  const refresh = useCallback(() => {
    if (!isSupported) return;
    setA11y(permissions.accessibility());
    setOverlay(permissions.overlay());
    setOn(isEnabled());
  }, []);

  /*
   * Funnel step 1. This screen IS the accessibility ask, so reaching it is the
   * top of the funnel — the denominator every later step is measured against.
   * Fires once per visit, not per permission re-read.
   */
  useEffect(() => {
    if (isSupported) track({ name: 'a11y_prompt_seen' });
  }, []);

  // Both permissions are granted in Settings, outside our process — so re-read
  // them every time the user comes back rather than trusting cached state.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const ready = a11y && overlay;

  const toggle = (next: boolean) => {
    if (next && !ready) {
      haptic.warning();
      toast.show('Grant both permissions first');
      return;
    }
    haptic.medium();
    setOn(setEnabled(next));
    // Funnel step 3 — the conversion. Both permissions granted AND the switch on
    // is the only state in which the product actually works.
    track(next ? { name: 'a11y_enabled' } : { name: 'a11y_disabled', via: 'app_toggle' });
    toast.show(next ? 'Watching for profiles & chats' : 'Turned off — nothing is read');
  };

  if (!isSupported) {
    return (
      <View
        style={[
          styles.root,
          styles.center,
          { paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: gutter },
        ]}
      >
        <Text style={styles.title}>Android only</Text>
        <Text style={styles.body}>
          The one-tap analyzer needs Android&apos;s accessibility APIs. On this device, use
          Profile Scan and pick a screenshot instead.
        </Text>
        <HapticPressable onPress={close} style={styles.cta}>
          <Text style={styles.ctaText}>Back</Text>
        </HapticPressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            paddingTop: insets.top + spacing.lg,
            // Gesture-nav devices put the home bar right under the last button.
            paddingBottom: insets.bottom + spacing.xxxl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.wordmark}>
            <Ionicons name="sparkles" size={20} color={palette.violet} />
            <Text style={styles.wordmarkText}>
              {firstRun ? 'Welcome to RizzCoach' : 'One-tap analyzer'}
            </Text>
          </View>
          <CircleIconButton
            icon="close"
            size={38}
            onPress={close}
            accessibilityLabel={firstRun ? 'Skip for now' : 'Close'}
          />
        </View>

        <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.hero}>
          <Text style={styles.title}>
            {firstRun ? 'Two steps and\nyou never screenshot again.' : 'Profiles and chats,\nwithout leaving the app.'}
          </Text>
          <Text style={styles.body}>
            Open a profile or a chat in Instagram, Tinder, Bumble, Hinge or Facebook — or any chat
            in WhatsApp, Snapchat or Telegram — and RizzCoach shows an ✨ button. On a profile, the
            report opens here. In a chat, it reads the thread, writes your best reply and copies it
            — just paste and send.
          </Text>
        </Animated.View>

        {/* Prominent disclosure — this is the compliance surface. Do not soften. */}
        <View style={styles.disclosure}>
          <Text style={styles.disclosureTitle}>What this reads, and when</Text>
          <Bullet icon="eye-outline" text="RizzCoach reads the screen of those five apps only, to recognise when you're on a profile or an open chat. It reads nothing in any other app." />
          <Bullet icon="hand-left-outline" text="It only acts when you tap ✨ — a screenshot on a profile, or the visible chat text in a conversation. Nothing is read in the background, ever." />
          <Bullet icon="cloud-upload-outline" text="That screenshot or chat text is sent to Google Gemini to write the report or the reply, then discarded. It is never saved to your device and never posted anywhere." />
          <Bullet icon="power-outline" text="The switch below turns it off instantly. Turning it off stops all screen reading." />
        </View>

        <Step
          n={1}
          title="Enable the accessibility service"
          body="Settings → Accessibility → RizzCoach Profile Analyzer. This is what lets us see you're on a profile."
          done={a11y}
          onPress={() => {
            haptic.light();
            track({ name: 'a11y_settings_opened' });
            permissions.openAccessibilitySettings();
          }}
        />
        <Step
          n={2}
          title="Allow drawing over other apps"
          body="So the ✨ Analyze button can appear on top of the profile."
          done={overlay}
          onPress={() => {
            haptic.light();
            permissions.openOverlaySettings();
          }}
        />

        <View style={[styles.switchRow, !ready && styles.dim]}>
          <View style={styles.switchText}>
            <Text style={styles.switchTitle}>Watch for profiles & chats</Text>
            <Text style={styles.switchSub}>
              {ready ? (on ? 'On — the ✨ button will appear' : 'Off — nothing is read') : 'Finish both steps above'}
            </Text>
          </View>
          <Switch
            value={on}
            onValueChange={toggle}
            disabled={!ready}
            trackColor={{ false: palette.surfaceHigh, true: `${palette.violet}88` }}
            thumbColor={on ? palette.violet : palette.textTertiary}
            accessibilityLabel="Watch for profiles"
          />
        </View>

        <Text style={styles.footnote}>
          You can turn this off any time here, or remove the permission in Android Settings.
        </Text>

        {firstRun && (
          <HapticPressable onPress={close} accessibilityLabel="Skip for now" style={styles.skip}>
            <Text style={styles.skipText}>
              {ready ? 'Done' : 'Skip for now — set it up later in Profile Scan'}
            </Text>
          </HapticPressable>
        )}
      </ScrollView>
      {toast.element}
    </View>
  );
}

function Step({
  n,
  title,
  body,
  done,
  onPress,
}: {
  n: number;
  title: string;
  body: string;
  done: boolean;
  onPress: () => void;
}) {
  return (
    <HapticPressable
      onPress={onPress}
      accessibilityLabel={`Step ${n}: ${title}${done ? ' — done' : ''}`}
      accessibilityRole="button"
      style={[styles.step, done && styles.stepDone]}
    >
      <View style={[styles.stepBadge, done && { backgroundColor: palette.mint }]}>
        {done ? (
          <Ionicons name="checkmark" size={15} color={palette.ink} />
        ) : (
          <Text style={styles.stepNum}>{n}</Text>
        )}
      </View>
      <View style={styles.stepText}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
      {!done && <Ionicons name="chevron-forward" size={16} color={palette.textTertiary} />}
    </HapticPressable>
  );
}

function Bullet({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.bullet}>
      <Ionicons name={icon} size={15} color={palette.violetBright} style={styles.bulletIcon} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  scroll: { gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmarkText: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, color: palette.textPrimary },
  hero: { gap: spacing.sm },
  title: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '900',
    letterSpacing: -0.8,
    color: palette.textPrimary,
  },
  body: { fontSize: 14.5, lineHeight: 21, color: palette.textSecondary },
  disclosure: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  disclosureTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: palette.textSecondary,
  },
  bullet: { flexDirection: 'row', gap: 10 },
  bulletIcon: { marginTop: 2 },
  bulletText: { flex: 1, fontSize: 13.5, lineHeight: 20, color: palette.textSecondary },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  stepDone: { borderColor: `${palette.mint}55` },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
  },
  stepNum: { fontSize: 12, fontWeight: '800', color: palette.textSecondary },
  stepText: { flex: 1, gap: 3 },
  stepTitle: { fontSize: 14.5, fontWeight: '700', color: palette.textPrimary },
  stepBody: { fontSize: 12.5, lineHeight: 18, color: palette.textTertiary },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  dim: { opacity: 0.55 },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { fontSize: 15, fontWeight: '800', color: palette.textPrimary },
  switchSub: { fontSize: 12.5, color: palette.textSecondary },
  footnote: { fontSize: 12, lineHeight: 17, color: palette.textTertiary, textAlign: 'center' },
  skip: { alignItems: 'center', paddingVertical: spacing.md },
  skipText: { fontSize: 13, fontWeight: '700', color: palette.textSecondary },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.full,
    backgroundColor: palette.violet,
  },
  ctaText: { fontSize: 15, fontWeight: '900', color: palette.textPrimary },
});
