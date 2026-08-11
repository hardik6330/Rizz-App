import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLayout } from '@/theme/layout';
import { glow, palette, radii, spacing } from '@/theme/tokens';

/**
 * Screen-local toast. Usage:
 *   const toast = useToast();
 *   toast.show('Copied');
 *   ...render {toast.element} as the last child of the screen root.
 */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  // The old flat 112 sat *on* the floating tab bar on devices with a tall
  // bottom inset. Clear the bar's own geometry instead.
  const bottom = Math.max(insets.bottom, 14) + 92;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((msg: string, durationMs = 1700) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), durationMs);
  }, []);

  const element = message ? (
    <View pointerEvents="none" style={[styles.host, { bottom, paddingHorizontal: gutter }]}>
      <Animated.View
        entering={FadeInUp.springify().damping(16)}
        exiting={FadeOut.duration(160)}
        style={styles.toast}
      >
        <Ionicons name="checkmark-circle" size={16} color={palette.mint} />
        {/* Long messages exist ("that doesn't look like a profile…"): let the
            pill wrap inside the gutter rather than run off both edges. */}
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  ) : null;

  return { show, element };
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.full,
    backgroundColor: 'rgba(27,27,42,0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    ...glow(palette.black, 0.5, 14),
  },
  text: {
    flexShrink: 1,
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
