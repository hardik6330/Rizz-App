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

import { duration } from '@/theme/motion';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';

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
    /*
     * No `useReducedMotion()` guard here, deliberately — this is the one repeating
     * animation in the app whose parked frame is already the right one.
     *
     * `ReduceMotion.System` jumps a `withRepeat` to its final value, which for
     * this is `1`: a fully-opaque live dot. That is what a live badge should look
     * like when it cannot pulse. The other four needed guards because their end
     * frames were wrong — a streak stranded at the CTA's edge, a drop pad held at
     * the peak of a breath, typing dots at quarter opacity. This one is not an
     * oversight; adding a guard here would change nothing but the diff.
     */
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

      <Animated.Text
        key={stageText}
        /*
         * Announced, not just drawn.
         *
         * This line is the only thing telling the user the engine is still
         * working, and it changes every ~1.6s for six to ten seconds. To a
         * screen reader it was silent — the whole wait was a blank screen with
         * no indication anything was happening, which is indistinguishable from
         * a hang. `polite` rather than `assertive` because it is progress, not
         * an alert: it should queue behind whatever is being read, not cut it.
         */
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        style={styles.stageText}
        entering={FadeInDown.duration(duration.standard)}
      >
        {stageText}
      </Animated.Text>

      <View style={styles.track}>
        <Animated.View
          layout={LinearTransition.duration(duration.deliberate)}
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
    ...typo.micro,
  },
  stageText: {
    ...typo.body,
    fontWeight: '700',
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
