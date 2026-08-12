import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RAIL_WIDTH, useLayout } from '@/theme/layout';
import { categoryColor, palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { FeedItem } from '@/types';
import { ActionRail } from './ActionRail';

interface FeedCardProps {
  item: FeedItem;
  height: number;
  saved: boolean;
  onCopy: () => void;
  onToggleSave: () => void;
  onShare: () => void;
}

/** One full-screen Discovery page: cinematic background + the line + rail. */
export function FeedCard({ item, height, saved, onCopy, onToggleSave, onShare }: FeedCardProps) {
  const insets = useSafeAreaInsets();
  const { gutter, landscape } = useLayout();
  const accent = categoryColor(item.category);
  const longLine = item.text.length > 110;
  /**
   * A landscape phone is ~half as tall as a portrait one, but this card's copy
   * block is unchanged — at the portrait size the quote alone overflows the
   * page. Step the display type down and give the tab bar less slack instead.
   */
  const bottomPad = insets.bottom + (landscape ? 84 : 132);

  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  const handleDoubleTap = () => {
    if (!saved) {
      onToggleSave();
    }
  };

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onStart(() => {
      runOnJS(handleDoubleTap)();
      
      heartScale.value = 0;
      heartOpacity.value = 1;
      
      heartScale.value = withSequence(
        withSpring(1, { damping: 12, stiffness: 200 }),
        withDelay(300, withSpring(0, { damping: 15, stiffness: 100 }))
      );
      
      heartOpacity.value = withSequence(
        withTiming(1, { duration: 100 }),
        withDelay(400, withTiming(0, { duration: 300 }))
      );
    });

  const animatedHeartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
    opacity: heartOpacity.value,
  }));

  return (
    <GestureDetector gesture={doubleTap}>
      <View style={{ height, width: '100%' }}>
        {item.background.image != null ? (
        <Image
          source={item.background.image}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={250}
        />
      ) : (
        <LinearGradient colors={item.background.colors} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient
        colors={['rgba(7,7,11,0.5)', 'rgba(7,7,11,0.05)', 'rgba(7,7,11,0.9)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          styles.content,
          {
            paddingLeft: gutter,
            // Clear the rail: its own right offset + width + breathing room.
            paddingRight: gutter + RAIL_WIDTH + spacing.lg,
            paddingBottom: bottomPad,
          },
        ]}
      >
        <View style={[styles.categoryChip, { backgroundColor: `${accent}29`, borderColor: `${accent}77` }]}>
          <Text style={[styles.categoryText, { color: accent }]} maxFontSizeMultiplier={1.2}>
            {item.category.toUpperCase()}
          </Text>
        </View>

        <Text
          style={[styles.line, (longLine || landscape) && styles.lineSmall]}
          maxFontSizeMultiplier={1.3}
        >
          “{item.text}”
        </Text>

        <View style={styles.contextRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={13} color={palette.textSecondary} />
          <Text style={styles.contextText}>{item.context}</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.statChip}>
            <View style={styles.statDot} />
            <Text style={styles.statText}>{item.successRate}% reply rate</Text>
          </View>
          <View style={styles.testerRow}>
            {item.testedBy.avatar != null && (
              <Image source={item.testedBy.avatar} style={styles.avatar} contentFit="cover" />
            )}
            <Text style={styles.testerText}>
              {item.testedBy.age === 0
                ? `✨ Fresh today · ${item.testedBy.name}`
                : `Field-tested by ${item.testedBy.name}, ${item.testedBy.age}`}
            </Text>
          </View>
        </View>
      </View>

      <ActionRail
        saved={saved}
        onCopy={onCopy}
        onToggleSave={onToggleSave}
        onShare={onShare}
        /* Hugs the screen edge on a phone (`gutter - spacing.md` is the original
           12), and follows the centred column on a tablet. */
        style={{ bottom: bottomPad + spacing.lg, right: Math.max(spacing.md, gutter - spacing.md) }}
      />

        <Animated.View style={[styles.heartOverlay, animatedHeartStyle]} pointerEvents="none">
          <Ionicons name="heart" size={140} color={palette.pink} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  categoryChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  categoryText: {
    ...typo.micro,
    letterSpacing: 1.4,
  },
  line: {
    ...typo.display,
    fontWeight: '800',
    lineHeight: 37,
    letterSpacing: -0.7,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 12,
    textShadowOffset: { width: 0, height: 2 },
  },
  lineSmall: {
    ...typo.h1,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contextText: {
    ...typo.label,
    fontWeight: '500',
    color: palette.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radii.full,
    backgroundColor: 'rgba(10,10,18,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${palette.mint}55`,
  },
  statDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.mint,
  },
  statText: {
    ...typo.caption,
    fontWeight: '700',
    color: palette.mint,
  },
  testerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  testerText: {
    ...typo.caption,
    fontWeight: '500',
  },
  heartOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
  },
});
