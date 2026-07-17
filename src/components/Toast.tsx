import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';

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
    <View pointerEvents="none" style={styles.host}>
      <Animated.View
        entering={FadeInUp.springify().damping(16)}
        exiting={FadeOut.duration(160)}
        style={styles.toast}
      >
        <Ionicons name="checkmark-circle" size={16} color={palette.mint} />
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
    bottom: 112,
    alignItems: 'center',
    zIndex: 60,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
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
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
