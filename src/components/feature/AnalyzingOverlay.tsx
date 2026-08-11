import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ANALYZE_STAGES } from '@/services/engine';
import { cardHeightFor, useLayout } from '@/theme/layout';
import { absoluteFill, palette, radii, spacing } from '@/theme/tokens';

/** Designed height on a normal portrait phone; short screens get less. */
const CARD_HEIGHT = 340;
const CARD_MIN_HEIGHT = 220;
const SCAN_HEIGHT = 120;

interface AnalyzingOverlayProps {
  uri: string;
  stage: number;
}

/** The picked screenshot with a sweeping violet scan beam + staged status. */
export function AnalyzingOverlay({ uri, stage }: AnalyzingOverlayProps) {
  const { height } = useLayout();
  // The beam sweeps the card, so its travel has to track the card's real height
  // — a fixed 340 overshot the bottom edge on a short screen.
  const cardHeight = cardHeightFor(height, CARD_HEIGHT, CARD_MIN_HEIGHT);
  /*
   * Reanimated already honours Reduce Motion for us — every animation defaults to
   * `ReduceMotion.System`, so `withRepeat` stops after one pass. For the pulsing
   * dot that is a fine resting state (it settles lit). For the beam it is not: it
   * freezes parked at the bottom edge of the card for the whole analysis, reading
   * as a rendering bug rather than as "motion off". So drop it entirely instead.
   */
  const reduceMotion = useReducedMotion();
  const scan = useSharedValue(0);
  const dot = useSharedValue(0.4);

  useEffect(() => {
    scan.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    dot.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
  }, [scan, dot]);

  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(scan.value, [0, 1], [0, cardHeight - SCAN_HEIGHT]) }],
  }));

  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));

  const progress = Math.min((stage + 1) / ANALYZE_STAGES.length, 1);
  const stageText = ANALYZE_STAGES[Math.min(stage, ANALYZE_STAGES.length - 1)];

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(16)}
      style={[styles.card, { height: cardHeight }]}
    >
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      <View style={styles.scrim} />

      {!reduceMotion && (
        <Animated.View style={[styles.scan, scanStyle]}>
          <LinearGradient
            colors={[
              'transparent',
              'rgba(139,92,246,0.28)',
              'rgba(139,92,246,0.85)',
              'rgba(139,92,246,0.28)',
              'transparent',
            ]}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}

      <View style={styles.badge}>
        <Animated.View style={[styles.badgeDot, dotStyle]} />
        <Text style={styles.badgeText}>ENGINE RUNNING</Text>
      </View>

      <View style={styles.panel}>
        <Animated.Text
          key={stageText}
          entering={FadeInDown.duration(260)}
          style={styles.stageText}
        >
          {stageText}
        </Animated.Text>
        <View style={styles.track}>
          <Animated.View
            layout={LinearTransition.duration(500)}
            style={[styles.fill, { width: `${progress * 100}%` }]}
          >
            <LinearGradient
              colors={[palette.violet, palette.pink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  scrim: {
    ...absoluteFill,
    backgroundColor: 'rgba(7,7,11,0.55)',
  },
  scan: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: SCAN_HEIGHT,
  },
  badge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: 'rgba(10,10,18,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.mint,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: palette.textSecondary,
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: 'rgba(10,10,18,0.72)',
  },
  stageText: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textPrimary,
    letterSpacing: -0.2,
  },
  track: {
    height: 5,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
});
