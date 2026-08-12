import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { palette, radii, spacing } from '@/theme/tokens';

/**
 * Placeholder blocks for content that is on its way.
 *
 * The Vault and Discover both read from MMKV and then from the server, and both
 * rendered their empty state during that gap — so a returning user with forty
 * saved lines saw "Zero lines banked (for now)" and a Browse button for as long
 * as hydration took. That is not a slow screen, it is a screen telling the user
 * their data is gone.
 *
 * ## Why a skeleton and not a spinner
 *
 * A spinner says "wait"; a skeleton says "here is the shape of what is coming",
 * which is the honest signal when we already know the layout. It also holds the
 * scroll height, so the list does not jump when the real rows land.
 *
 * ## The pulse
 *
 * 900ms in and out — slower than any interaction in `motion.ts` on purpose. A
 * skeleton is ambient rather than responsive, and one pulsing at interaction
 * speed reads as something you are supposed to press. Static under Reduce
 * Motion: a full-screen loop is exactly what that setting is for.
 */

const PULSE_MS = 900;

export function Skeleton({
  width = '100%',
  height,
  radius = radii.sm,
}: {
  width?: DimensionValue;
  height: number;
  radius?: number;
}) {
  const pulse = useSharedValue(0.5);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: PULSE_MS }), -1, true);
  }, [pulse, reduced]);

  const style = useAnimatedStyle(() => ({ opacity: reduced ? 0.6 : pulse.value }));

  return (
    <Animated.View
      // One label for the whole group, on the host below — announcing "loading"
      // once per block would read the same word eight times.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius }, styles.block, style]}
    />
  );
}

/**
 * A run of skeleton rows shaped like a saved line: two text bars and a short
 * meta bar, inside the same card the real row uses.
 */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your saved lines"
      style={styles.list}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.card}>
          <Skeleton height={13} width="92%" />
          <Skeleton height={13} width="64%" />
          <Skeleton height={10} width="30%" radius={radii.full} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: palette.surfaceHigh,
  },
  list: {
    gap: spacing.sm + 2,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
  },
});
