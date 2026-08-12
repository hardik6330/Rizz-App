import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { duration } from '@/theme/motion';
import { glyph, palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { EngineMode } from '@/types';
import { haptic } from '@/utils/haptics';
import { HapticPressable } from './HapticPressable';
import Animated, { FadeIn } from 'react-native-reanimated';

const MODES: { key: EngineMode; label: string; emoji: string; color: string }[] = [
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
    <Animated.View entering={FadeIn.duration(duration.quick)} style={styles.row}>
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
            <Text style={styles.emoji} maxFontSizeMultiplier={1.2}>
              {item.emoji}
            </Text>
            <Text
              style={[styles.label, active && { color: palette.textPrimary }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {item.label}
            </Text>
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
    // "Vibe Check" is wider than a third of a 320pt phone. Without minWidth 0
    // it forced the whole row past the gutter and clipped the last pill.
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  emoji: {
    fontSize: glyph.lg,
    lineHeight: 20,
  },
  label: {
    // RN defaults flexShrink to 0; text will not shrink into the pill without it.
    ...typo.label,
    flexShrink: 1,
    fontWeight: '700',
    color: palette.textSecondary,
  },
});
