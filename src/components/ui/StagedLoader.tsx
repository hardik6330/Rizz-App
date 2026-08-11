import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { palette, radii, spacing } from '@/theme/tokens';

interface StagedLoaderProps {
  /** Status lines cycled while the engine works. */
  stages: string[];
  /** Index of the current stage. */
  stage: number;
  /** Pill label, e.g. "WRITING" or "SCANNING 2 IMAGES". */
  badge: string;
  /** Progress bar color — each tool has its own accent. */
  tint: string;
}

/**
 * Text-only "engine is thinking" card: live badge, staged status copy and a
 * progress bar. Used by the Bio Optimizer and Profile Scan.
 *
 * The Lab uses `AnalyzingOverlay` instead — it sweeps a scan beam over the
 * picked screenshot, which is a genuinely different visual, not this with a
 * flag bolted on.
 */
export function StagedLoader({ stages, stage, badge, tint }: StagedLoaderProps) {
  const dot = useSharedValue(0.4);

  useEffect(() => {
    dot.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
  }, [dot]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));

  const progress = Math.min((stage + 1) / stages.length, 1);
  const stageText = stages[Math.min(stage, stages.length - 1)];

  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.card}>
      <View style={styles.badge}>
        <Animated.View style={[styles.badgeDot, dotStyle]} />
        <Text style={styles.badgeText}>{badge}</Text>
      </View>

      <Animated.Text key={stageText} entering={FadeInDown.duration(260)} style={styles.stageText}>
        {stageText}
      </Animated.Text>

      <View style={styles.track}>
        <Animated.View
          layout={LinearTransition.duration(500)}
          style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: tint }]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    alignItems: 'center',
  },
  badge: {
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
  stageText: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textPrimary,
    letterSpacing: -0.2,
  },
  track: {
    width: '100%',
    height: 5,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
  },
});
