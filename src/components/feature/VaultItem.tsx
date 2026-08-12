import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { EXIT } from '@/theme/motion';
import { categoryColor, palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { SavedItem } from '@/types';
import { timeAgo } from '@/utils/misc';
import { CircleIconButton } from '@/components/ui/CircleIconButton';

interface VaultItemProps {
  item: SavedItem;
  index: number;
  onCopy: () => void;
  onShare: () => void;
  onRemove: () => void;
}

/** One saved line inside the Favorites Vault. */
export function VaultItem({ item, index, onCopy, onShare, onRemove }: VaultItemProps) {
  const accent = categoryColor(item.category);
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(17)}
      exiting={FadeOut.duration(EXIT)}
      layout={LinearTransition.springify().damping(18)}
      style={styles.card}
    >
      <View style={[styles.accentBar, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <Text style={styles.text} numberOfLines={3}>
          {item.text}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.categoryChip, { backgroundColor: `${accent}1C`, borderColor: `${accent}4D` }]}>
            <Text style={[styles.categoryText, { color: accent }]}>
              {item.category === 'Engine' ? 'FROM ENGINE' : item.category.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.time}>{timeAgo(item.savedAt)}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <CircleIconButton icon="copy-outline" size={32} onPress={onCopy} accessibilityLabel="Copy line" />
        <CircleIconButton icon="share-outline" size={32} onPress={onShare} accessibilityLabel="Share line" />
        <CircleIconButton
          icon="trash-outline"
          size={32}
          color={palette.danger}
          onPress={onRemove}
          accessibilityLabel="Delete from vault"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  body: {
    flex: 1,
    gap: spacing.sm,
  },
  text: {
    ...typo.reply,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  categoryText: {
    ...typo.micro,
    letterSpacing: 1,
  },
  time: {
    ...typo.overline,
    letterSpacing: 0,
    textTransform: 'none',
    fontWeight: '400',
    color: palette.textTertiary,
  },
  actions: {
    justifyContent: 'center',
    flexShrink: 0,
    gap: spacing.sm,
  },
});
