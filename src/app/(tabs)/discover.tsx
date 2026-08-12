import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard } from '@/components/feature/FeedCard';
import { Button } from '@/components/ui/Button';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { LimitBadge, ProChip } from '@/components/ui/LimitBadge';
import { LockOverlay } from '@/components/feature/LockOverlay';
import { useToast } from '@/components/ui/Toast';
import { APP_NAME, FREE_SWIPE_LIMIT } from '@/constants';
import { FEED_ITEMS } from '@/data/feed';
import { generateFreshOpeners } from '@/services/feedEngine';
import { restorePurchases } from '@/services/purchases';
import { swipesUsedToday, todayKey } from '@/state/limits';
import { useRizzStore } from '@/state/useRizzStore';
import { CHIP_HIT_SLOP, useLayout, useTabBarClearance } from '@/theme/layout';
import { glyph, categoryColor, palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { FeedCategory, FeedItem } from '@/types';
import { haptic } from '@/utils/haptics';
import { copyLine, shareText } from '@/utils/misc';

const FILTERS: { key: FeedCategory | 'All'; label: string }[] = [
  { key: 'All', label: 'All' },
  { key: 'Opener', label: 'Openers' },
  { key: 'Comeback', label: 'Comebacks' },
  { key: 'Recovery', label: 'Recovery' },
  { key: 'Closer', label: 'Closers' },
];

/** A card counts as viewed once 60% of it is on screen. Constant, so module scope. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

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
  /**
   * Lines whose view has already been counted against today's allowance.
   *
   * **Keyed by item id, not by list index.** It was a `Set<number>` of indices,
   * and `changeFilter` reset it to `new Set([0])` — so the same line, viewed
   * under "All" and again under "Openers", was two different indices and got
   * charged twice. Browsing three filters could burn the whole ten-swipe
   * allowance on about four distinct lines, and the user has no way to see why.
   *
   * Ids survive filtering, reordering and the daily feed landing on top of the
   * curated set, which indices do not. Never reset on a filter change.
   */
  const seen = useRef<Set<string>>(new Set());
  /** Buzz once per time the limit is reached, not once per render. */
  const warnedAtLimit = useRef(false);

  const changeFilter = useCallback((next: FeedCategory | 'All') => {
    haptic.selection();
    setFilter(next);
    setIndex(0);
    // `seen` deliberately NOT cleared — see above.
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

  /*
   * Hitting the limit buzzes and stops the feed. It does NOT open the paywall.
   *
   * It used to do both: a 420ms timer pushed the paywall AND `LockOverlay`
   * rendered underneath it, so the user got a full-screen purchase modal they
   * had not asked for — fired mid-swipe, while their thumb was still moving —
   * and then found a second lock waiting behind it when they dismissed it.
   *
   * The overlay already carries "Unlock" and "Restore", so nothing is harder to
   * reach; the difference is only whether the user opened it. That also makes
   * `paywall_viewed` mean something: it was counting ambushes, which is
   * indistinguishable in the funnel from intent.
   */
  useEffect(() => {
    if (locked && !warnedAtLimit.current) {
      warnedAtLimit.current = true;
      haptic.warning();
    }
    if (!locked) warnedAtLimit.current = false;
  }, [locked]);

  /**
   * Arriving on the screen is not a swipe.
   *
   * The old index-keyed `seen` was pre-seeded with `0` for exactly this reason —
   * the first card is already on screen before the user does anything, and
   * charging for it means the allowance is really nine. Ids cannot be pre-seeded
   * (the first item depends on the filter and on whether today's AI batch has
   * landed), so the first viewability callback marks instead of charging.
   */
  const arrived = useRef(false);

  /*
   * `useRef(fn).current`, and reading `.current` during render, is the pattern
   * FlatList documents for this prop — it warns and re-measures if
   * `onViewableItemsChanged` changes identity between renders, so it cannot be a
   * `useCallback` with real dependencies. The rule is right in general and wrong
   * here; the closure only touches refs and `getState()`, never render state.
   */
  // eslint-disable-next-line react-hooks/refs
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = viewableItems[0];
    if (visible?.index == null) return;
    setIndex(visible.index);

    const id = (visible.item as FeedItem).id;
    if (seen.current.has(id)) return;
    seen.current.add(id);
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    useRizzStore.getState().incrementSwipe();
  }).current;

  const copyItem = useCallback((item: FeedItem) => copyLine(item.text, toast.show), [toast]);

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
      toggleSave({ id: item.id, text: item.text, category: item.category });
    },
    [toggleSave],
  );

  const handleRestore = useCallback(async () => {
    const restored = await restorePurchases();
    if (restored) {
      setPro(true);
      toast.show('Pro restored — welcome back');
    } else {
      toast.show('No purchases found', { tone: 'info' });
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
        viewabilityConfig={VIEWABILITY_CONFIG}
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
                hitSlop={CHIP_HIT_SLOP}
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
        <Button
          label="Go Pro for unlimited"
          icon="diamond"
          variant="accent"
          color={palette.gold}
          size="md"
          onPress={onGoPro}
          accessibilityLabel="Open RizzCoach Pro"
          style={styles.endCta}
        />
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
    fontSize: glyph.xxl,
  },
  endTitle: {
    ...typo.h1,
    fontWeight: '900',
  },
  endSub: {
    ...typo.bodyMuted,
    textAlign: 'center',
  },
  // Spacing only — fill, radius and label belong to <Button>.
  endCta: {
    marginTop: spacing.sm,
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
    ...typo.caption,
    fontWeight: '700',
  },
  title: {
    ...typo.h2,
    fontWeight: '900',
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
    ...typo.caption,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
