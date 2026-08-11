import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticPressable } from '@/components/ui/HapticPressable';
import { APP_NAME } from '@/constants';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing } from '@/theme/tokens';
import type { CoachApp, CoachStruggle, CoachStyle } from '@/types';
import { haptic } from '@/utils/haptics';

/**
 * First-run setup, step 2 of 3 (account → **here** → analyzer).
 *
 * Three questions, and **every answer changes the model's output** — see
 * `coachParts()` in `backend/src/ai/prompts.ts`. That is the whole design
 * constraint: a question whose answer only gets stored is three taps of friction
 * for nothing, and it is what most of this category ships. If a question is
 * added here, it lands in `coachParts` in the same change or it does not land.
 *
 * There is no skip. Not for conversion theatre — the app's first screen is
 * "upload a screenshot", which tells a new user nothing about what this is for,
 * and every question here is one the engines genuinely need. It is 3 taps, and
 * the single-choice steps advance on tap rather than making them press Continue
 * twice.
 *
 * The answers are NOT sensitive and none of them is free text: closed enums
 * only, so there is nothing here a user could type that becomes a prompt
 * instruction, and nothing that needs the analytics rules in `analytics.ts`.
 */

const APPS: { key: CoachApp; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'tinder', label: 'Tinder', icon: 'flame' },
  { key: 'bumble', label: 'Bumble', icon: 'happy' },
  { key: 'hinge', label: 'Hinge', icon: 'heart' },
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { key: 'snapchat', label: 'Snapchat', icon: 'logo-snapchat' },
];

const STRUGGLES: { key: CoachStruggle; label: string; sub: string }[] = [
  { key: 'opening', label: 'Starting the conversation', sub: 'The first message never comes out right' },
  { key: 'keeping', label: 'Keeping it alive', sub: 'It dies after three or four messages' },
  { key: 'asking_out', label: 'Asking them out', sub: 'It goes well and then I stall' },
  { key: 'replying', label: "Knowing what to reply", sub: 'I read it, I go blank' },
];

const STYLES: { key: CoachStyle; label: string; sub: string }[] = [
  { key: 'casual', label: 'Casual', sub: 'lowercase, relaxed, no polish' },
  { key: 'funny', label: 'Funny', sub: 'jokes, bits, a bit silly' },
  { key: 'dry', label: 'Dry', sub: 'deadpan, no emoji, no exclamation marks' },
  { key: 'flirty', label: 'Flirty', sub: 'warm and forward' },
  { key: 'short', label: 'Short', sub: 'one line, few words' },
];

const STEPS = 3;

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const setCoach = useRizzStore((s) => s.setCoach);
  const coach = useRizzStore((s) => s.coach);

  const [step, setStep] = useState(0);
  const [apps, setApps] = useState<CoachApp[]>([]);
  const [struggle, setStruggle] = useState<CoachStruggle | null>(null);

  /*
   * Mandatory, so Android's back button must not dismiss it — same rule and
   * same mechanism as the account gate in `account.tsx`. Back steps BACKWARDS
   * through the questions instead, and is swallowed on the first one: there is
   * nothing behind this screen to go back to that the user is allowed in.
   */
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setStep((current) => Math.max(0, current - 1));
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const toggleApp = (key: CoachApp) => {
    haptic.light();
    setApps((current) =>
      current.includes(key) ? current.filter((app) => app !== key) : [...current, key],
    );
  };

  const pickStruggle = (key: CoachStruggle) => {
    haptic.light();
    setStruggle(key);
    setStep(2);
  };

  /**
   * **The only exit, and it is not called here.** Answering writes the store; the
   * store having answers is what closes the screen.
   *
   * Because the other way to acquire answers is the server: a reinstall logs in,
   * `/v1/user/credits` returns the stored profile, and `adoptCoach` fills the
   * store while this screen is already on its way up — the launch push fires on a
   * 400ms timer and the round trip does not always beat it. Closing on the store
   * rather than on the tap means that user gets the screen dismissed out from
   * under them instead of being asked three questions they already answered on
   * their old phone.
   */
  useEffect(() => {
    if (coach) router.back();
  }, [coach]);

  const finish = (style: CoachStyle) => {
    haptic.success();
    // `struggle` cannot be null here — step 2 is only reachable through
    // `pickStruggle` — but the store type does not know that, and a fallback is
    // cheaper than a non-null assertion that a future re-order would make a lie.
    setCoach({ apps, struggle: struggle ?? 'opening', style });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.xxxl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progress}>
          {Array.from({ length: STEPS }, (_, i) => (
            <View key={i} style={[styles.tick, i <= step && styles.tickOn]} />
          ))}
        </View>

        {step === 0 && (
          <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.page}>
            <Text style={styles.kicker}>Setting up {APP_NAME}</Text>
            <Text style={styles.title}>Where are you{'\n'}talking to people?</Text>
            <Text style={styles.body}>
              A Hinge prompt and a WhatsApp thread need different messages. Pick every one you use.
            </Text>
            <View style={styles.chips}>
              {APPS.map((app) => {
                const on = apps.includes(app.key);
                return (
                  <HapticPressable
                    key={app.key}
                    onPress={() => toggleApp(app.key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={app.label}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Ionicons
                      name={app.icon}
                      size={16}
                      color={on ? palette.textPrimary : palette.textTertiary}
                    />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{app.label}</Text>
                  </HapticPressable>
                );
              })}
            </View>
            <Cta
              label={apps.length === 0 ? 'Pick at least one' : 'Continue'}
              disabled={apps.length === 0}
              onPress={() => setStep(1)}
            />
          </Animated.View>
        )}

        {step === 1 && (
          <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.page}>
            <Text style={styles.kicker}>Question 2 of {STEPS}</Text>
            <Text style={styles.title}>Where does it{'\n'}usually go wrong?</Text>
            <Text style={styles.body}>
              This changes what every reply is aiming for — not just how it sounds.
            </Text>
            {STRUGGLES.map((item) => (
              <Row
                key={item.key}
                label={item.label}
                sub={item.sub}
                on={struggle === item.key}
                onPress={() => pickStruggle(item.key)}
              />
            ))}
          </Animated.View>
        )}

        {step === 2 && (
          <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.page}>
            <Text style={styles.kicker}>Last one</Text>
            <Text style={styles.title}>How do you{'\n'}actually text?</Text>
            <Text style={styles.body}>
              Lines that do not sound like you are the ones that get spotted. We write in your
              register, never a smoother one.
            </Text>
            {STYLES.map((item) => (
              <Row
                key={item.key}
                label={item.label}
                sub={item.sub}
                on={false}
                onPress={() => finish(item.key)}
              />
            ))}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

function Row({
  label,
  sub,
  on,
  onPress,
}: {
  label: string;
  sub: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <HapticPressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}. ${sub}`}
      style={[styles.row, on && styles.rowOn]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.textTertiary} />
    </HapticPressable>
  );
}

function Cta({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <HapticPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.cta, disabled && styles.ctaOff]}
    >
      <Text style={styles.ctaText}>{label}</Text>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  scroll: { gap: spacing.xl },
  progress: { flexDirection: 'row', gap: 6 },
  tick: { flex: 1, height: 3, borderRadius: 2, backgroundColor: palette.surfaceHigh },
  tickOn: { backgroundColor: palette.violet },
  page: { gap: spacing.md },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: palette.textTertiary,
  },
  title: {
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '900',
    letterSpacing: -0.8,
    color: palette.textPrimary,
  },
  body: { fontSize: 14.5, lineHeight: 21, color: palette.textSecondary, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  chipOn: { backgroundColor: palette.surfaceHigh, borderColor: palette.violet },
  chipText: { fontSize: 14, fontWeight: '700', color: palette.textSecondary },
  chipTextOn: { color: palette.textPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  rowOn: { borderColor: palette.violet },
  rowText: { flex: 1, gap: 3 },
  rowLabel: { fontSize: 15, fontWeight: '800', color: palette.textPrimary },
  rowSub: { fontSize: 12.5, lineHeight: 18, color: palette.textTertiary },
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: radii.full,
    backgroundColor: palette.violet,
    marginTop: spacing.sm,
  },
  ctaOff: { backgroundColor: palette.surfaceHigh },
  ctaText: { fontSize: 15, fontWeight: '900', color: palette.textPrimary },
});
