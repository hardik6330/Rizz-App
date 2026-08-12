import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HapticPressable } from '@/components/ui/HapticPressable';
import { useBubbleState } from '@/hooks/useBubbleState';
import { palette, radii, semantic, spacing, type as typo } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * One line on the Lab saying whether the ✨ bubble is on, and turning it on.
 *
 * ## Why this exists
 *
 * The bubble is the only thing in this product a competitor cannot ship — it
 * writes the reply inside Instagram or Tinder without the user leaving the app,
 * and `docs/README.md` calls it "the actual moat". Its entire discoverability
 * was one row at the bottom of the Profile Scan tab and one dismissible first-run
 * prompt. A user who never finds it experiences a commodity screenshot app and
 * churns to a cheaper one, and enabling it is almost certainly the strongest
 * retention signal in the product.
 *
 * ## Why it is a strip and not the card
 *
 * Profile Scan keeps the full explanatory card — that tab is the analyzer's
 * permanent home and the place someone goes to *understand* it. This is the Lab,
 * where the screenshot drop zone is the primary action and must stay that way.
 * So the two are deliberately different densities of the same fact, sharing
 * their state through `useBubbleState` rather than each deriving it.
 *
 * ## Why "on" still renders
 *
 * Quietly, and on purpose: an invisible feature is one people forget they have,
 * and the line is also the only place a user can notice the OS has killed it.
 * The off and killed states get the accent and the dot; the on state is a muted
 * line that costs one row.
 */
export function BubbleStrip() {
  const { supported, watching, killed } = useBubbleState();
  if (!supported) return null;

  const needsAction = killed || !watching;

  const { icon, tint, text } = killed
    ? {
        icon: 'warning' as const,
        tint: semantic.warning,
        text: 'Bubble stopped by your phone — tap to restart it',
      }
    : watching
      ? {
          icon: 'sparkles' as const,
          tint: palette.textTertiary,
          text: 'Bubble on — tap ✨ inside Instagram, Tinder or WhatsApp',
        }
      : {
          icon: 'sparkles-outline' as const,
          tint: palette.violet,
          text: 'Reply without leaving Instagram — turn on the ✨ bubble',
        };

  return (
    <HapticPressable
      onPress={() => {
        haptic.light();
        router.push('/analyzer');
      }}
      accessibilityRole="button"
      accessibilityLabel={text}
      style={[styles.row, needsAction && { borderColor: `${tint}55` }]}
    >
      <Ionicons name={icon} size={15} color={tint} />
      <Text style={[styles.text, watching && !killed && styles.textMuted]} numberOfLines={2}>
        {text}
      </Text>
      {needsAction && <View style={[styles.dot, { backgroundColor: tint }]} />}
      <Ionicons name="chevron-forward" size={14} color={palette.textTertiary} />
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  text: {
    ...typo.caption,
    flex: 1,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  textMuted: {
    fontWeight: '400',
    color: palette.textTertiary,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radii.full,
  },
});
