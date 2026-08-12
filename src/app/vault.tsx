import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyVault } from '@/components/feature/EmptyVault';
import { useToast } from '@/components/ui/Toast';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { VaultItem } from '@/components/feature/VaultItem';
import { APP_NAME } from '@/constants';
import { hydrateVault, useRizzStore } from '@/state/useRizzStore';
import { CHIP_HIT_SLOP, useLayout } from '@/theme/layout';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { SavedItem } from '@/types';
import { haptic } from '@/utils/haptics';
import { copyLine, shareText } from '@/utils/misc';

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

  React.useEffect(() => {
    void hydrateVault();
  }, []);

  const [itemToDelete, setItemToDelete] = useState<SavedItem | null>(null);
  const [isClearConfirming, setIsClearConfirming] = useState(false);

  const items = useMemo(() => {
    const sorted = [...savedItems].sort((a, b) => b.savedAt - a.savedAt);
    return filter === 'All' ? sorted : sorted.filter((item) => item.category === filter);
  }, [savedItems, filter]);

  const copyItem = (item: SavedItem) => copyLine(item.text, toast.show);

  const shareItem = async (item: SavedItem) => {
    haptic.medium();
    const outcome = await shareText(`"${item.text}"\n\n— from my ${APP_NAME} vault`);
    if (outcome === 'copied') toast.show("Copied. Go get 'em.");
  };

  const onRequestRemoveItem = (item: SavedItem) => {
    haptic.warning();
    setItemToDelete(item);
  };

  const executeRemoveItem = () => {
    if (!itemToDelete) return;
    haptic.warning();
    removeSaved(itemToDelete.id);
    setItemToDelete(null);
    toast.show('Line removed');
  };

  const onRequestClearVault = () => {
    haptic.warning();
    setIsClearConfirming(true);
  };

  const executeClearVault = () => {
    haptic.warning();
    clearVault();
    setIsClearConfirming(false);
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
            onPress={onRequestClearVault}
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
                hitSlop={CHIP_HIT_SLOP}
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
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
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
            onRemove={() => onRequestRemoveItem(item)}
          />
        )}
      />

      <ConfirmDialog
        visible={itemToDelete !== null}
        title="Remove saved line?"
        body="This deletes the line from your vault on every device. There is no undo."
        confirmLabel="Remove"
        onConfirm={executeRemoveItem}
        onCancel={() => setItemToDelete(null)}
      />

      <ConfirmDialog
        visible={isClearConfirming}
        title="Clear entire vault?"
        body="This permanently deletes every saved line, on every device. There is no undo."
        confirmLabel="Clear all"
        onConfirm={executeClearVault}
        onCancel={() => setIsClearConfirming(false)}
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
    ...typo.h1,
    fontWeight: '900',
  },
  subtitle: {
    ...typo.caption,
    fontWeight: '400',
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
    ...typo.caption,
    fontWeight: '600',
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
    ...typo.label,
    fontWeight: '400',
    color: palette.textTertiary,
  },
});
