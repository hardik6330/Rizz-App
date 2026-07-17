import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { VibeCheck } from '@/types';

interface VibeCheckCardProps {
  vibe: VibeCheck;
}

/** Psychological diagnosis of the other person's texting persona. */
export function VibeCheckCard({ vibe }: VibeCheckCardProps) {
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = 0;
    fill.value = withDelay(
      380,
      withTiming(vibe.interest, { duration: 950, easing: Easing.out(Easing.cubic) }),
    );
  }, [vibe.interest, fill]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value}%` }));

  return (
    <Animated.View entering={FadeInDown.springify().damping(17)} style={styles.card}>
      {/* Persona header */}
      <View style={styles.header}>
        <View style={styles.emojiBubble}>
          <Text style={styles.emoji}>{vibe.emoji}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.overline}>TEXTING PERSONA</Text>
          <Text style={styles.persona}>{vibe.persona}</Text>
        </View>
        <View style={styles.confidenceChip}>
          <Text style={styles.confidenceText}>{vibe.confidence}% sure</Text>
        </View>
      </View>

      {/* Interest meter */}
      <View style={styles.meterBlock}>
        <View style={styles.meterLabelRow}>
          <Text style={styles.meterLabel}>Interest level</Text>
          <Text style={styles.meterValue}>{vibe.interest}%</Text>
        </View>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]}>
            <LinearGradient
              colors={[palette.cyan, palette.violet, palette.pink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </View>
      </View>

      {/* Traits */}
      <View style={styles.traits}>
        {vibe.traits.map((trait) => (
          <View key={trait} style={styles.traitChip}>
            <Text style={styles.traitText}>{trait}</Text>
          </View>
        ))}
      </View>

      {/* Red flags */}
      {vibe.redFlags.length > 0 && (
        <View style={styles.flags}>
          {vibe.redFlags.map((flag) => (
            <View key={flag} style={styles.flagRow}>
              <Text style={styles.flagEmoji}>🚩</Text>
              <Text style={styles.flagText}>{flag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Verdict */}
      <View style={styles.verdictBox}>
        <Text style={styles.verdictText}>“{vibe.verdict}”</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  emojiBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.cyan}1C`,
    borderWidth: 1,
    borderColor: `${palette.cyan}44`,
  },
  emoji: {
    fontSize: 24,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  overline: {
    ...typo.overline,
    color: palette.cyan,
  },
  persona: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: palette.textPrimary,
  },
  confidenceChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textSecondary,
  },
  meterBlock: {
    gap: spacing.sm,
  },
  meterLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meterLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  meterValue: {
    fontSize: 14,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  track: {
    height: 9,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  traits: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  traitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
  },
  traitText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  flags: {
    gap: 6,
  },
  flagRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  flagEmoji: {
    fontSize: 12,
    marginTop: 2,
  },
  flagText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: palette.textSecondary,
  },
  verdictBox: {
    backgroundColor: palette.ink,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: palette.cyan,
  },
  verdictText: {
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
    color: palette.textSecondary,
  },
});
