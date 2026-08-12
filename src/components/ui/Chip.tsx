import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CHIP_HIT_SLOP } from '@/theme/layout';
import { glyph, palette, radii, spacing, type as typo } from '@/theme/tokens';
import { HapticPressable } from './HapticPressable';

/**
 * The one pill.
 *
 * There were four, hand-built in `vault` (filters), `discover` (filters and the
 * card counter), `bio` (interests) and `onboarding` (which apps you use) — the
 * same rounded outline at four vertical paddings (7 / 7 / 10 / 11), two label
 * weights, and three different ways of saying "selected". Same story as
 * `Button.tsx`: nothing was wrong with any one of them, they just did not agree.
 *
 * ## The two things that were NOT drift
 *
 * `overImage` is a real variant, not an inconsistency. Discover's filters float
 * over a full-bleed photo, so they need an opaque-ish ground and the stronger
 * hairline to stay legible against whatever is behind them; the same chip on a
 * dark screen would look like a hole. Keeping that as a flag is the difference
 * between one component and two.
 *
 * `size` collapses the four paddings to two, and the split is by JOB. `sm` is a
 * filter in a row you scan — dense on purpose, and it takes `CHIP_HIT_SLOP` so
 * the target is 44pt even though the pill is 30. `md` is a choice you make, one
 * of a handful, where the pill IS the target and shrinking it would be hostile.
 *
 * ## Selected state
 *
 * Tint at 24/2E alpha on the fill and 88 on the border — never a solid fill.
 * A solid accent pill reads as a button, and a row of six buttons where one is
 * lit is not a filter row, it is six primary actions. The label going from
 * `textSecondary` to `textPrimary` carries as much of the signal as the colour
 * does, which is what keeps it legible for a colour-blind user.
 */

interface ChipProps {
  label: string;
  /** Selected. Drives the tint, the label colour and the a11y state. */
  on?: boolean;
  /** Omit for a static chip (a counter, a badge) — it renders as a plain View. */
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Leading emoji. Mutually exclusive with `icon` in practice; both is noise. */
  emoji?: string;
  /** Tint when `on`. Defaults to the brand violet. */
  accent?: string;
  size?: 'sm' | 'md';
  /** Floating over a photo — see the docblock. */
  overImage?: boolean;
  /** `tab` for a filter row, `checkbox` for a multi-select, `radio` for one-of-N. */
  accessibilityRole?: 'button' | 'tab' | 'checkbox' | 'radio';
  accessibilityLabel?: string;
  /** Digits that must not jitter as they count — the Discover position chip. */
  tabularNums?: boolean;
  style?: StyleProp<ViewStyle>;
}

const PAD: Record<'sm' | 'md', { paddingVertical: number; paddingHorizontal: number }> = {
  sm: { paddingVertical: 7, paddingHorizontal: spacing.md + 2 },
  md: { paddingVertical: 10, paddingHorizontal: spacing.lg },
};

export function Chip({
  label,
  on = false,
  onPress,
  icon,
  emoji,
  accent = palette.violet,
  size = 'sm',
  overImage = false,
  accessibilityRole = 'button',
  accessibilityLabel,
  tabularNums = false,
  style,
}: ChipProps) {
  const body = (
    <>
      {emoji != null && <Text style={styles.emoji}>{emoji}</Text>}
      {icon != null && (
        <Ionicons name={icon} size={15} color={on ? palette.textPrimary : palette.textTertiary} />
      )}
      <Text
        style={[
          styles.label,
          size === 'md' && styles.labelMd,
          // After `labelMd`, which carries its own colour — flip the order and
          // the selected label silently stays grey on every `md` chip.
          on && styles.labelOn,
          tabularNums && styles.tabular,
        ]}
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
      >
        {label}
      </Text>
    </>
  );

  const box: StyleProp<ViewStyle> = [
    styles.base,
    PAD[size],
    overImage ? styles.overImage : styles.onScreen,
    on && { backgroundColor: `${accent}2E`, borderColor: `${accent}88` },
    style,
  ];

  // Static: no role, no press target, nothing for a screen reader to try.
  if (onPress == null) return <View style={box}>{body}</View>;

  return (
    <HapticPressable
      // Chips are picked in runs of three or four while scanning a row; a haptic
      // on each one is a buzzing phone, not feedback. The callers that want it
      // fire `haptic.selection()` themselves.
      feedback="none"
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityRole === 'checkbox' ? { checked: on } : { selected: on }}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={size === 'sm' ? CHIP_HIT_SLOP : undefined}
      style={box}
    >
      {body}
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  onScreen: {
    backgroundColor: palette.surface,
    borderColor: palette.hairline,
  },
  overImage: {
    backgroundColor: 'rgba(10,10,18,0.55)',
    borderColor: palette.hairlineStrong,
  },
  emoji: {
    fontSize: glyph.md,
  },
  label: {
    ...typo.caption,
    fontWeight: '700',
  },
  labelMd: {
    ...typo.label,
    fontWeight: '700',
    color: palette.textSecondary,
  },
  labelOn: {
    color: palette.textPrimary,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
