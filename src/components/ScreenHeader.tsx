import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FREE_ANALYSIS_LIMIT } from '@/constants';
import { useRizzStore } from '@/state/useRizzStore';
import { palette, spacing } from '@/theme/tokens';
import { CircleIconButton } from './CircleIconButton';
import { LimitBadge, ProChip } from './LimitBadge';

interface ScreenHeaderProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** Wordmark icon color — each tool has its own accent. */
  tint: string;
}

/**
 * Shared top bar for the three AI tools (Lab, Profile Scan, Bio Optimizer):
 * wordmark + free-credit meter + vault button with a saved-count bubble.
 * Reads the store itself so screens don't re-wire the same selectors.
 */
export function ScreenHeader({ icon, title, tint }: ScreenHeaderProps) {
  const isPro = useRizzStore((state) => state.isPro);
  const analysisCount = useRizzStore((state) => state.analysisCount);
  const savedCount = useRizzStore((state) => state.savedItems.length);

  return (
    <View style={styles.header}>
      <View style={styles.wordmark}>
        <Ionicons name={icon} size={20} color={tint} />
        <Text style={styles.wordmarkText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
      </View>

      <View style={styles.headerActions}>
        {isPro ? <ProChip /> : <LimitBadge used={analysisCount} limit={FREE_ANALYSIS_LIMIT} />}
        <View>
          <CircleIconButton
            icon="bookmark-outline"
            size={38}
            color={palette.textPrimary}
            onPress={() => router.push('/vault')}
            accessibilityLabel="Open your vault"
          />
          {savedCount > 0 && (
            <View style={styles.countBubble}>
              {/* Lives in a 17pt bubble — never let the OS font scale grow it. */}
              <Text style={styles.countText} maxFontSizeMultiplier={1}>
                {Math.min(savedCount, 99)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'center',
    // The title is the only elastic part of this row — the credit meter and the
    // vault button are fixed, so it absorbs a narrow screen or a large font.
    flexShrink: 1,
    gap: 6,
  },
  wordmarkText: {
    flexShrink: 1,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.5,
    color: palette.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing.sm,
  },
  countBubble: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: palette.violet,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: palette.ink,
  },
  countText: {
    fontSize: 9,
    fontWeight: '800',
    color: palette.textPrimary,
  },
});
