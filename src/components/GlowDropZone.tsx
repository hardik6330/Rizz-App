import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BG } from '@/data/assets';
import { cardHeightFor, useLayout } from '@/theme/layout';
import { palette, radii, spacing } from '@/theme/tokens';
import { HapticPressable } from './HapticPressable';

interface GlowDropZoneProps {
  onPress: () => void;
  /** Out of free analyses — swaps copy + glow to the shared upsell state. */
  locked: boolean;
  title: string;
  subtitle: string;
  /** Ring gradient. [0] also tints the dashes, chip and outer glow. */
  accent: [string, string];
  /** Cinematic background asset (RN asset id from require()). */
  background: number;
}

/**
 * The breathing, glowing screenshot drop pad — the centerpiece of both the Lab
 * and Profile Scan. Copy/accent/background come from the caller; the locked
 * upsell state is identical everywhere so it stays in here.
 */
export function GlowDropZone({
  onPress,
  locked,
  title,
  subtitle,
  accent: accentProp,
  background,
}: GlowDropZoneProps) {
  const { height } = useLayout();
  const pulse = useSharedValue(0);
  /**
   * `minHeight`, not `height`: the copy inside grows with the OS font scale and
   * used to be clipped by the fixed 300. The cap keeps the designed size on any
   * normal portrait phone and shrinks it on short screens (landscape, a folded
   * cover display) where 300 was most of the page.
   */
  const cardHeight = cardHeightFor(height, 300, 200);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: 0.22 + pulse.value * 0.3,
    transform: [{ scale: 1 + pulse.value * 0.012 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.value * 0.45,
  }));

  const ringColors: [string, string] = locked ? [palette.gold, palette.ember] : accentProp;
  const accent = locked ? palette.gold : accentProp[0];

  return (
    <Animated.View style={[styles.glow, { shadowColor: accent }, glowStyle]}>
      <HapticPressable
        feedback="medium"
        onPress={onPress}
        accessibilityLabel={locked ? 'Unlock more analyses' : title}
        style={[styles.card, { minHeight: cardHeight }]}
      >
        <Image
          source={locked ? BG.ember : background}
          style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
          contentFit="cover"
          transition={400}
        />
        <LinearGradient
          colors={['rgba(10,10,18,0.15)', 'rgba(10,10,18,0.55)', 'rgba(10,10,18,0.92)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.dashed, { borderColor: `${accent}55` }]} />

        <Animated.View style={[styles.ring, ringStyle]}>
          <LinearGradient
            colors={ringColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.ringGradient}
          >
            <View style={styles.ringInner}>
              <Ionicons name={locked ? 'lock-closed' : 'scan'} size={30} color={palette.textPrimary} />
            </View>
          </LinearGradient>
        </Animated.View>

        <Text style={styles.title}>{locked ? "You're out of free reads" : title}</Text>
        <Text style={styles.subtitle}>
          {locked ? 'Go Pro for unlimited screenshot breakdowns.' : subtitle}
        </Text>

        <View style={[styles.chip, { borderColor: `${accent}44` }]}>
          <Ionicons name={locked ? 'diamond' : 'image'} size={13} color={accent} />
          <Text style={[styles.chipText, { color: accent }]}>
            {locked ? 'Unlock RizzCoach Pro' : 'Tap to upload'}
          </Text>
        </View>
      </HapticPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: {
    borderRadius: radii.xl,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({ android: { elevation: 14 } }),
  },
  card: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  dashed: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1.2,
    borderStyle: 'dashed',
  },
  ring: {
    marginBottom: spacing.xs,
  },
  ringGradient: {
    width: 84,
    height: 84,
    borderRadius: 42,
    padding: 2.5,
  },
  ringInner: {
    flex: 1,
    borderRadius: 40,
    backgroundColor: '#141422',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: palette.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.textSecondary,
    textAlign: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.full,
    borderWidth: 1,
    backgroundColor: 'rgba(10,10,18,0.55)',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
