import type { BottomTabBarProps } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_HIT_SLOP, useLayout } from '@/theme/layout';
import { duration } from '@/theme/motion';
import { absoluteFill, glow, palette, radii, spacing, type as typo } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';
import { HapticPressable } from '@/components/ui/HapticPressable';

const ICONS: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  index: { outline: 'sparkles-outline', filled: 'sparkles' },
  profile: { outline: 'scan-outline', filled: 'scan' },
  bio: { outline: 'person-outline', filled: 'person' },
  discover: { outline: 'flame-outline', filled: 'flame' },
};

const LABELS: Record<string, string> = {
  index: 'Lab',
  profile: 'Scan',
  bio: 'Bio',
  discover: 'Discover',
};

/** Frosted floating pill tab bar — the feed scrolls behind it. */
export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width, compact } = useLayout();
  /**
   * Four items and a labelled active pill: at 18pt each side this row is ~304pt
   * wide, which is the entire usable width of a 320pt phone. Tighten the item
   * padding there so the bar keeps its floating margins instead of touching the
   * screen edges, and cap the pill so it can never exceed them.
   */
  const itemPad = compact ? spacing.md : 18;

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: Math.max(insets.bottom, 14) + 4 }]}>
      <View style={[styles.pill, { maxWidth: width - spacing.lg * 2 }]}>
        <BlurView intensity={55} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.tint} />
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const icons = ICONS[route.name] ?? { outline: 'ellipse-outline', filled: 'ellipse' };
          const label = LABELS[route.name] ?? route.name;

          const onPress = () => {
            haptic.selection();
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <HapticPressable
              key={route.key}
              feedback="none"
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              /*
               * The pill travels instead of cutting.
               *
               * A true sliding indicator is not available here: the active item
               * is WIDER than the others because it gains a label, so an
               * absolutely-positioned bar would need next-frame geometry it
               * cannot have and would snap to the wrong width before correcting.
               * Animating the layout itself gets the same read — the gradient
               * grows out of the tapped icon and collapses into the one you
               * left — with no measurement and no second source of truth.
               */
              layout={LinearTransition.duration(duration.standard)}
              hitSlop={TAB_HIT_SLOP}
              style={styles.itemWrap}
            >
              {focused ? (
                <LinearGradient
                  colors={[palette.violetDeep, palette.violet]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.itemActive, { paddingHorizontal: itemPad }]}
                >
                  <Ionicons name={icons.filled} size={17} color={palette.textPrimary} />
                  {/* Fades in behind the growing pill rather than appearing at
                      full width on frame one, which read as a pop. */}
                  <Animated.Text
                    entering={FadeIn.duration(duration.quick)}
                    style={styles.labelActive}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.15}
                  >
                    {label}
                  </Animated.Text>
                </LinearGradient>
              ) : (
                <View style={[styles.item, { paddingHorizontal: itemPad }]}>
                  <Ionicons name={icons.outline} size={19} color={palette.textTertiary} />
                </View>
              )}
            </HapticPressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    padding: 5,
    gap: 4,
    borderRadius: radii.full,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    ...glow(palette.black, 0.55, 18),
  },
  tint: {
    ...absoluteFill,
    backgroundColor: 'rgba(13,13,21,0.58)',
  },
  itemWrap: {
    flexShrink: 1,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radii.full,
  },
  itemActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radii.full,
  },
  labelActive: {
    ...typo.label,
    flexShrink: 1,
    fontWeight: '700',
  },
});
