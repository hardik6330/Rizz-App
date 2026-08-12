import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { palette, radii, spacing, type as typo } from '@/theme/tokens';

interface LimitBadgeProps {
  used: number;
  limit: number;
  icon?: keyof typeof Ionicons.glyphMap;
}

/** Free-tier meter pill, e.g. "⚡ 2/3 free". Turns hot when exhausted. */
export function LimitBadge({ used, limit, icon = 'flash' }: LimitBadgeProps) {
  const exhausted = used >= limit;
  const tint = exhausted ? palette.ember : palette.violetBright;
  return (
    <View style={[styles.pill, { borderColor: `${tint}55`, backgroundColor: `${tint}1A` }]}>
      <Ionicons name={icon} size={12} color={tint} />
      <Text style={[styles.text, { color: tint }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {Math.min(used, limit)}/{limit} free
      </Text>
    </View>
  );
}

/** Gold membership chip shown instead of the meter once Pro is active. */
export function ProChip() {
  return (
    <View style={[styles.pill, styles.proPill]}>
      <Ionicons name="diamond" size={12} color={palette.gold} />
      <Text style={[styles.text, { color: palette.gold }]} maxFontSizeMultiplier={1.2}>
        PRO
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  proPill: {
    borderColor: `${palette.gold}66`,
    backgroundColor: `${palette.gold}1A`,
  },
  text: {
    ...typo.caption,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
