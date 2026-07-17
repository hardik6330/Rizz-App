import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { palette, radii, spacing } from '@/theme/tokens';
import type { ReplyOption } from '@/types';
import { CircleIconButton } from './CircleIconButton';

const STYLE_COLORS: Record<ReplyOption['style'], string> = {
  Smooth: palette.cyan,
  Playful: palette.pink,
  Bold: palette.ember,
};

interface ReplyCardProps {
  option: ReplyOption;
  index: number;
  saved: boolean;
  onCopy: () => void;
  onToggleSave: () => void;
}

/** One generated reply option with copy + save actions and a spice meter. */
export function ReplyCard({ option, index, saved, onCopy, onToggleSave }: ReplyCardProps) {
  const color = STYLE_COLORS[option.style];
  return (
    <Animated.View
      entering={FadeInDown.delay(90 * index)
        .springify()
        .damping(17)}
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={[styles.styleChip, { backgroundColor: `${color}1F`, borderColor: `${color}55` }]}>
          <Text style={[styles.styleText, { color }]}>{option.style.toUpperCase()}</Text>
        </View>
        <Text style={styles.spice}>{'🌶️'.repeat(option.spice)}</Text>
        <View style={styles.spacer} />
        <CircleIconButton
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          active={saved}
          onPress={onToggleSave}
          accessibilityLabel={saved ? 'Remove from vault' : 'Save to vault'}
        />
        <CircleIconButton icon="copy-outline" onPress={onCopy} accessibilityLabel="Copy reply" />
      </View>
      <Text style={styles.text}>{option.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  styleChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  styleText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  spice: {
    fontSize: 11,
  },
  spacer: {
    flex: 1,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.textPrimary,
  },
});
