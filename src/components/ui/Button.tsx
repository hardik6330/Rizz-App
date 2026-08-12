import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import { HapticPressable } from './HapticPressable';

/**
 * The one call-to-action.
 *
 * There were seven of these, hand-built in `onboarding`, `ai-consent`, `bio`,
 * `profile`, `EmptyVault`, `AppErrorBoundary` and the Discover end card — the
 * same row-of-icon-and-label pill, at three different heights (12 / 15 / 16pt of
 * padding), two label weights and two label colours, with each screen deciding
 * for itself whether a light fill got dark text. Nothing was wrong with any one
 * of them; they just did not agree, and a primary action that changes height
 * between screens is the cheapest kind of inconsistency to remove.
 *
 * **The two gradient CTAs are deliberately NOT here.** `paywall.tsx` and
 * `LockOverlay.tsx` fill with a `LinearGradient` and carry a coloured glow —
 * that is a different component wearing the same shape, and flattening them into
 * a `variant` would mean this file importing gradients and shadows to serve two
 * call sites. They are the sell screens; let them be cinematic.
 *
 * Label colour is a property of the VARIANT, never of the caller. That is the
 * bug this closes: `accent` fills (mint, cyan, gold) are light and take ink,
 * `primary` is violet and takes white, and picking the wrong one was previously
 * one typo away on every screen.
 */

type Variant = 'primary' | 'accent' | 'ghost' | 'danger';
type Size = 'lg' | 'md';

interface ButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: Variant;
  size?: Size;
  /**
   * Fill for `accent` only — the per-tool tint (`profile` is cyan for your own
   * profile and violet for someone else's, `bio` is mint). Ignored by every
   * other variant, because those ARE their colour.
   */
  color?: string;
  disabled?: boolean;
  /** Swaps the content for a spinner and blocks the press. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Defaults to `label`; pass when the label alone is not the whole action. */
  accessibilityLabel?: string;
}

/** Height comes from vertical padding so the pill grows with the OS font scale. */
const PAD: Record<Size, number> = { lg: 16, md: 12 };

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  size = 'lg',
  color,
  disabled = false,
  busy = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const blocked = disabled || busy;

  const fill: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: palette.violet }
      : variant === 'accent'
        ? { backgroundColor: color ?? palette.violetBright }
        : variant === 'danger'
          ? { backgroundColor: `${palette.danger}1F`, borderWidth: 1, borderColor: `${palette.danger}66` }
          : { backgroundColor: `${palette.violet}1F`, borderWidth: 1, borderColor: `${palette.violet}66` };

  const labelColor =
    variant === 'accent'
      ? palette.ink
      : variant === 'danger'
        ? palette.danger
        : variant === 'ghost'
          ? palette.violetBright
          : palette.textPrimary;

  return (
    <HapticPressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked, busy }}
      style={[
        styles.base,
        { paddingVertical: PAD[size] },
        fill,
        // Disabled is a flat surface, not the fill at low opacity: a 40%-opacity
        // brand colour still reads as the brand colour and so still reads as
        // pressable. `busy` keeps the fill — that one IS still working.
        disabled && !busy && styles.off,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          {icon != null && (
            <Ionicons name={icon} size={17} color={disabled ? palette.textTertiary : labelColor} />
          )}
          {/* One line: these are actions, and a CTA that wraps to two lines on a
              narrow phone at large text has already lost the layout. */}
          <Text
            style={[styles.label, { color: disabled ? palette.textTertiary : labelColor }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </Text>
        </>
      )}
    </HapticPressable>
  );
}

/** Full-width row of buttons that share the line equally. */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.full,
  },
  off: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 0,
  },
  label: {
    ...typo.body,
    // Heavier than `body`: this is the one thing on the screen the user is meant
    // to press, and the weight is what separates it from the copy above it.
    fontWeight: '900',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
