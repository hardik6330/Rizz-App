import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/ui/Chip';
import { SkeletonList } from '@/components/ui/Skeleton';
import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyVault } from '@/components/feature/EmptyVault';
import { useToast } from '@/components/ui/Toast';
import { VaultItem } from '@/components/feature/VaultItem';
import { APP_NAME } from '@/constants';
import { hydrateVault, useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
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
  const [query, setQuery] = useState('');
  /**
   * The server pull, which is a different thing from the MMKV read.
   *
   * MMKV rehydrates synchronously, so a user who saved on THIS device has their
   * lines on the first frame and never sees a skeleton. The case this exists for
   * is the reinstall: local store empty, forty lines on the server, and the
   * screen confidently rendering "Zero lines banked (for now)" with a Browse
   * button until the fetch lands. That is not a slow screen, it is a screen
   * telling someone their vault is gone.
   */
  const [hydrating, setHydrating] = useState(true);

  const savedItems = useRizzStore((state) => state.savedItems);
  const removeSaved = useRizzStore((state) => state.removeSaved);
  const clearVault = useRizzStore((state) => state.clearVault);

  React.useEffect(() => {
    let alive = true;
    // `finally`, not `then`: a failed fetch is also done hydrating, and leaving
    // this true for ever would replace the empty state with a permanent
    // skeleton — the worse of the two wrong answers.
    void hydrateVault().finally(() => {
      if (alive) setHydrating(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [itemToDelete, setItemToDelete] = useState<SavedItem | null>(null);
  const [isClearConfirming, setIsClearConfirming] = useState(false);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...savedItems]
      .sort((a, b) => b.savedAt - a.savedAt)
      .filter((item) => filter === 'All' || item.category === filter)
      // Substring, case-insensitive, on the line itself. Deliberately not fuzzy
      // and not tokenised: the user is looking for a line they have read, and
      // they type the words they remember from it. A vault is hundreds of rows
      // at most, so this runs on every keystroke without being felt.
      .filter((item) => needle === '' || item.text.toLowerCase().includes(needle));
  }, [savedItems, filter, query]);

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

      {savedItems.length > 0 && (
        <View style={[styles.searchWrap, { marginHorizontal: gutter }]}>
          <Ionicons name="search" size={16} color={palette.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your lines…"
            placeholderTextColor={palette.textTertiary}
            style={styles.search}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search saved lines"
          />
          {/* Android has no `clearButtonMode`, and a field you can only empty by
              holding backspace is a field people leave filtered by accident. */}
          {query.length > 0 && (
            <CircleIconButton
              icon="close"
              size={26}
              onPress={() => setQuery('')}
              accessibilityLabel="Clear search"
            />
          )}
        </View>
      )}

      {/* Category filters */}
      {savedItems.length > 0 && (
        <View style={[styles.filters, { paddingHorizontal: gutter }]}>
          {FILTERS.map((value) => (
            <Chip
              key={value}
              label={value}
              on={value === filter}
              accessibilityRole="tab"
              accessibilityLabel={`Filter: ${value}`}
              onPress={() => {
                haptic.selection();
                setFilter(value);
              }}
            />
          ))}
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
          hydrating && savedItems.length === 0 ? (
            <SkeletonList />
          ) : savedItems.length === 0 ? (
            <EmptyVault onBrowse={browseFeed} />
          ) : (
            <Text style={styles.noMatches}>
              {query.trim() === ''
                ? 'Nothing saved in this category yet.'
                : `No saved line matches "${query.trim()}".`}
            </Text>
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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    marginBottom: spacing.md,
    borderRadius: radii.full,
    // Recessed, not raised: this is a hole you type into. See `surfaceInset`.
    backgroundColor: palette.surfaceInset,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  search: {
    ...typo.body,
    flex: 1,
    paddingVertical: 10,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  filterChipActive: {
    backgroundColor: `${palette.violet}24`,
    borderColor: `${palette.violet}88`,
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
