import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/CircleIconButton';
import { EmptyVault } from '@/components/EmptyVault';
import { useToast } from '@/components/Toast';
import { HapticPressable } from '@/components/HapticPressable';
import { VaultItem } from '@/components/VaultItem';
import { APP_NAME } from '@/constants';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing } from '@/theme/tokens';
import type { SavedItem } from '@/types';
import { haptic } from '@/utils/haptics';
import { shareText } from '@/utils/misc';

const FILTERS = ['All', 'Opener', 'Comeback', 'Recovery', 'Closer', 'Engine', 'Bio'] as const;
type Filter = (typeof FILTERS)[number];

export default function VaultScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('All');

  const savedItems = useRizzStore((state) => state.savedItems);
  const removeSaved = useRizzStore((state) => state.removeSaved);
  const clearVault = useRizzStore((state) => state.clearVault);

  const items = useMemo(() => {
    const sorted = [...savedItems].sort((a, b) => b.savedAt - a.savedAt);
    return filter === 'All' ? sorted : sorted.filter((item) => item.category === filter);
  }, [savedItems, filter]);

  const copyItem = async (item: SavedItem) => {
    await Clipboard.setStringAsync(item.text);
    haptic.success();
    toast.show("Copied. Go get 'em.");
  };

  const shareItem = async (item: SavedItem) => {
    haptic.medium();
    const outcome = await shareText(`"${item.text}"\n\n— from my ${APP_NAME} vault`);
    if (outcome === 'copied') toast.show("Copied. Go get 'em.");
  };

  const removeItem = (item: SavedItem) => {
    haptic.warning();
    removeSaved(item.id);
  };

  const confirmClear = () => {
    haptic.warning();
    clearVault();
    toast.show('Vault cleared');
  };

  const browseFeed = () => {
    router.dismiss();
    router.navigate('/discover');
  };

  return (
    /* Android renders this modal full-screen, so without the top inset the
       grabber and title sat under the status bar. iOS sheets report 0 here. */
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.grabber} />

      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Your Vault</Text>
          <Text style={styles.subtitle}>
            {savedItems.length === 0
              ? 'Zero lines banked (for now)'
              : `${savedItems.length} ${savedItems.length === 1 ? 'line' : 'lines'} locked in`}
          </Text>
        </View>
        {savedItems.length > 0 && (
          <CircleIconButton
            icon="trash-outline"
            size={38}
            color={palette.danger}
            onPress={confirmClear}
            accessibilityLabel="Clear entire vault"
          />
        )}
        <CircleIconButton
          icon="close"
          size={38}
          color={palette.textPrimary}
          onPress={() => router.back()}
          accessibilityLabel="Close vault"
        />
      </View>

      {/* Category filters */}
      {savedItems.length > 0 && (
        <View style={[styles.filters, { paddingHorizontal: gutter }]}>
          {FILTERS.map((value) => {
            const active = value === filter;
            return (
              <HapticPressable
                key={value}
                feedback="none"
                onPress={() => {
                  haptic.selection();
                  setFilter(value);
                }}
                accessibilityLabel={`Filter: ${value}`}
                accessibilityState={{ selected: active }}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{value}</Text>
              </HapticPressable>
            );
          })}
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.xl },
        ]}
        ItemSeparatorComponent={Separator}
        showsVerticalScrollIndicator={false}
        /*
         * Virtualization bounds, which this list had none of.
         *
         * The vault is the one screen with no cap on how much it holds — scan
         * history is capped at 20, but saved items grow for as long as someone
         * keeps tapping the bookmark. With the defaults, FlatList rendered a
         * window sized for a list it had no measurements for, and every item is
         * a card with its own entering animation.
         *
         * Modest numbers on purpose: these are text cards, so the risk is
         * over-rendering, not blank space while scrolling. `discover.tsx` gets
         * the aggressive treatment because its items are full-screen.
         *
         * No `getItemLayout` — items are variable height (a saved line can wrap
         * to three lines or one), and a wrong fixed height there is worse than
         * none: it desynchronises scroll position from content.
         */
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          savedItems.length === 0 ? (
            <EmptyVault onBrowse={browseFeed} />
          ) : (
            <Text style={styles.noMatches}>Nothing saved in this category yet.</Text>
          )
        }
        renderItem={({ item, index }) => (
          <VaultItem
            item={item}
            index={index}
            onCopy={() => void copyItem(item)}
            onShare={() => void shareItem(item)}
            onRemove={() => removeItem(item)}
          />
        )}
      />

      {toast.element}
    </View>
  );
}

/**
 * Hoisted out of the render.
 *
 * As an inline arrow this was a NEW component type on every render of the
 * screen, so React unmounted and remounted every separator in the list each
 * time the filter chip changed. Defining it once makes it a stable type.
 */
function Separator() {
  return <View style={{ height: spacing.sm + 2 }} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.ink,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.6,
    color: palette.textPrimary,
  },
  subtitle: {
    fontSize: 12.5,
    color: palette.textSecondary,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  filterChipActive: {
    backgroundColor: `${palette.violet}24`,
    borderColor: `${palette.violet}88`,
  },
  filterText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  filterTextActive: {
    color: palette.textPrimary,
  },
  list: {
    paddingTop: spacing.xs,
    flexGrow: 1,
  },
  noMatches: {
    textAlign: 'center',
    marginTop: spacing.xxl,
    fontSize: 13,
    color: palette.textTertiary,
  },
});
