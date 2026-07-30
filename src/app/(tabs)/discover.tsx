import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard } from '@/components/FeedCard';
import { HapticPressable } from '@/components/HapticPressable';
import { LimitBadge, ProChip } from '@/components/LimitBadge';
import { LockOverlay } from '@/components/LockOverlay';
import { useToast } from '@/components/Toast';
import { APP_NAME, FREE_SWIPE_LIMIT } from '@/constants';
import { FEED_ITEMS } from '@/data/feed';
import { generateFreshOpeners } from '@/services/feedEngine';
import { restorePurchases } from '@/services/purchases';
import { swipesUsedToday, todayKey } from '@/state/limits';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout, useTabBarClearance } from '@/theme/layout';
import { categoryColor, palette, radii, spacing } from '@/theme/tokens';
import type { FeedCategory, FeedItem } from '@/types';
import { haptic } from '@/utils/haptics';
import { shareText } from '@/utils/misc';

const FILTERS: { key: FeedCategory | 'All'; label: string }[] = [
  { key: 'All', label: 'All' },
  { key: 'Opener', label: 'Openers' },
  { key: 'Comeback', label: 'Comebacks' },
  { key: 'Recovery', label: 'Recovery' },
  { key: 'Closer', label: 'Closers' },
];

export default function DiscoverScreen() {
  // Page height is the window height, so this must be the live value — it is
  // what makes the feed re-lay-out on rotation and on a foldable's hinge.
  const { height, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const bottomClearance = useTabBarClearance();
  const toast = useToast();

  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState<FeedCategory | 'All'>('All');
  const listRef = useRef<FlatList<FeedItem>>(null);
  const seen = useRef<Set<number>>(new Set([0]));
  const pushedPaywall = useRef(false);

  const changeFilter = useCallback((next: FeedCategory | 'All') => {
    haptic.selection();
    setFilter(next);
    setIndex(0);
    seen.current = new Set([0]);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const isPro = useRizzStore((state) => state.isPro);
  const swipeCount = useRizzStore((state) => state.swipeCount);
  const swipeDate = useRizzStore((state) => state.swipeDate);
  const savedItems = useRizzStore((state) => state.savedItems);
  const toggleSave = useRizzStore((state) => state.toggleSave);
  const setPro = useRizzStore((state) => state.setPro);
  const dailyFeed = useRizzStore((state) => state.dailyFeed);
  const dailyFeedDate = useRizzStore((state) => state.dailyFeedDate);
  const setDailyFeed = useRizzStore((state) => state.setDailyFeed);

  const today = todayKey();
  // Yesterday's count doesn't gate today — the free allowance is per-day.
  const swipesToday = swipesUsedToday(swipeCount, swipeDate, today);
  const locked = !isPro && swipesToday >= FREE_SWIPE_LIMIT;

  // Refresh the AI openers once per day; today's fresh lines go on top.
  useEffect(() => {
    // Bump the version tag when the batch shape/size changes so stale caches regenerate.
    const tag = `${today}:v3`;
    if (dailyFeedDate === tag) return;
    let cancelled = false;
    generateFreshOpeners().then((items) => {
      if (!cancelled && items.length > 0) setDailyFeed(items, tag);
    });
    return () => {
      cancelled = true;
    };
    // Run once on mount — the date guard prevents redundant fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Today's AI lines lead; the curated set backs them up so the feed always has depth.
  const allItems = useMemo(() => [...dailyFeed, ...FEED_ITEMS], [dailyFeed]);

  const data = useMemo(
    () => (filter === 'All' ? allItems : allItems.filter((item) => item.category === filter)),
    [filter, allItems],
  );

  useEffect(() => {
    if (locked && !pushedPaywall.current) {
      pushedPaywall.current = true;
      haptic.warning();
      const timer = setTimeout(() => router.push('/paywall?source=swipe_limit'), 420);
      return () => clearTimeout(timer);
    }
    if (!locked) pushedPaywall.current = false;
  }, [locked]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visibleIndex = viewableItems[0]?.index;
    if (visibleIndex == null) return;
    setIndex(visibleIndex);
    if (!seen.current.has(visibleIndex)) {
      seen.current.add(visibleIndex);
      useRizzStore.getState().incrementSwipe();
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const copyItem = useCallback(
    async (item: FeedItem) => {
      await Clipboard.setStringAsync(item.text);
      haptic.success();
      toast.show("Copied. Go get 'em.");
    },
    [toast],
  );

  const shareItem = useCallback(
    async (item: FeedItem) => {
      haptic.medium();
      const result = await shareText(`"${item.text}"\n\n— stolen from ${APP_NAME} 😮‍💨`);
      if (result === 'copied') toast.show("Copied. Go get 'em.");
    },
    [toast],
  );

  const saveItem = useCallback(
    (item: FeedItem) => {
      haptic.light();
      toggleSave({ id: item.id, text: item.text, category: item.category, source: 'feed' });
    },
    [toggleSave],
  );

  const handleRestore = useCallback(async () => {
    const restored = await restorePurchases();
    if (restored) {
      setPro(true);
      toast.show('Pro restored — welcome back');
    } else {
      toast.show('No purchases found');
    }
  }, [setPro, toast]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <FeedCard
        item={item}
        height={height}
        saved={savedItems.some((saved) => saved.id === item.id)}
        onCopy={() => void copyItem(item)}
        onToggleSave={() => saveItem(item)}
        onShare={() => void shareItem(item)}
      />
    ),
    [height, savedItems, copyItem, saveItem, shareItem],
  );

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        pagingEnabled
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        scrollEnabled={!locked}
        getItemLayout={(_, itemIndex) => ({
          length: height,
          offset: height * itemIndex,
          index: itemIndex,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={2}
        maxToRenderPerBatch={3}
        windowSize={5}
        ListFooterComponent={
          <EndCard
            height={height}
            bottomClearance={bottomClearance}
            isPro={isPro}
            onGoPro={() => router.push('/paywall?source=swipe_limit')}
          />
        }
      />

      {/* Top overlay */}
      <View
        pointerEvents="box-none"
        style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}
      >
        <View style={[styles.titleRow, { paddingHorizontal: gutter }]}>
          <View style={styles.wordmark}>
            <Ionicons name="flame" size={20} color={palette.ember} />
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              Discover
            </Text>
          </View>
          <View style={styles.topRight}>
            {isPro ? <ProChip /> : <LimitBadge used={swipesToday} limit={FREE_SWIPE_LIMIT} icon="flame" />}
            <View style={styles.counterChip}>
              <Text style={styles.counterText} maxFontSizeMultiplier={1.2}>
                {data.length === 0 ? '0/0' : `${Math.min(index + 1, data.length)}/${data.length}`}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filterRow, { paddingHorizontal: gutter }]}
        >
          {FILTERS.map(({ key, label }) => {
            const active = key === filter;
            const accent = key === 'All' ? palette.violet : categoryColor(key);
            return (
              <HapticPressable
                key={key}
                feedback="none"
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => changeFilter(key)}
                style={[
                  styles.filterChip,
                  active && { backgroundColor: `${accent}2E`, borderColor: `${accent}88` },
                ]}
              >
                <Text
                  style={[styles.filterText, active && { color: palette.textPrimary }]}
                  maxFontSizeMultiplier={1.2}
                >
                  {label}
                </Text>
              </HapticPressable>
            );
          })}
        </ScrollView>
      </View>

      {locked && (
        <LockOverlay onUnlock={() => router.push('/paywall?source=swipe_limit')} onRestore={() => void handleRestore()} />
      )}

      {toast.element}
    </View>
  );
}

/** Final page of the feed — closes the loop instead of silently running out. */
function EndCard({
  height,
  bottomClearance,
  isPro,
  onGoPro,
}: {
  height: number;
  bottomClearance: number;
  isPro: boolean;
  onGoPro: () => void;
}) {
  return (
    <View style={[styles.endCard, { height, paddingBottom: bottomClearance }]}>
      <Text style={styles.endEmoji}>🔥</Text>
      <Text style={styles.endTitle}>That&apos;s today&apos;s drop</Text>
      <Text style={styles.endSub}>
        {isPro
          ? 'Fresh lines land every morning. See you tomorrow.'
          : 'New AI lines every morning — come back tomorrow for the next drop.'}
      </Text>
      {!isPro && (
        <HapticPressable onPress={onGoPro} accessibilityLabel="Open RizzCoach Pro" style={styles.endCta}>
          <Ionicons name="diamond" size={15} color={palette.ink} />
          <Text style={styles.endCtaText}>Go Pro for unlimited</Text>
        </HapticPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.ink,
  },
  endCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    backgroundColor: palette.ink,
  },
  endEmoji: {
    fontSize: 44,
  },
  endTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.6,
    color: palette.textPrimary,
  },
  endSub: {
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
    color: palette.textSecondary,
  },
  endCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: 13,
    borderRadius: radii.full,
    backgroundColor: palette.gold,
  },
  endCtaText: {
    fontSize: 14,
    fontWeight: '900',
    color: palette.ink,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 6,
  },
  filterRow: {
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.full,
    backgroundColor: 'rgba(10,10,18,0.55)',
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
  filterText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: palette.textSecondary,
  },
  title: {
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.4,
    color: palette.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing.sm,
  },
  counterChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: 'rgba(10,10,18,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  counterText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: palette.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});
