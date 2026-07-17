import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { palette, radii, spacing } from '@/theme/tokens';
import type { EngineMode } from '@/types';
import { haptic } from '@/utils/haptics';
import { HapticPressable } from './HapticPressable';
import Animated, { FadeIn } from 'react-native-reanimated';

export const MODES: { key: EngineMode; label: string; emoji: string; color: string }[] = [
  { key: 'rizz', label: 'Rizz', emoji: '💬', color: palette.violet },
  { key: 'vibe', label: 'Vibe Check', emoji: '🔮', color: palette.cyan },
  { key: 'roast', label: 'Roast', emoji: '🔥', color: palette.ember },
];

interface ModeSelectorProps {
  mode: EngineMode;
  onChange: (mode: EngineMode) => void;
}

/** Segmented pills that pick which engine output is shown. */
export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.row}>
      {MODES.map((item) => {
        const active = item.key === mode;
        return (
          <HapticPressable
            key={item.key}
            feedback="none"
            accessibilityRole="tab"
            accessibilityLabel={`${item.label} mode`}
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptic.selection();
              onChange(item.key);
            }}
            style={[
              styles.pill,
              active && { backgroundColor: `${item.color}24`, borderColor: `${item.color}88` },
            ]}
          >
            <Text style={styles.emoji}>{item.emoji}</Text>
            <Text style={[styles.label, active && { color: palette.textPrimary }]}>{item.label}</Text>
          </HapticPressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  emoji: {
    fontSize: 13,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textSecondary,
  },
});
