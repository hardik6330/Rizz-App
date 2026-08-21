import type { BottomTabBarProps } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_HIT_SLOP, useLayout } from '@/theme/layout';
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
   * Every item is now icon-over-label, so the widest one is "Discover" at ~52pt
   * rather than an 18pt-padded row that only the active item labelled. Four of
   * those plus gaps lands around 236pt, well inside a 320pt phone — which is what
   * makes labelling all four affordable at all. Still tightened on compact so the
   * bar keeps its floating margins, and still capped below.
   */
  const itemPad = compact ? spacing.sm : spacing.md;

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: Math.max(insets.bottom, 14) + 4 }]}>
      {/*
        The glow lives on this wrapper, NOT on the pill.

        `overflow: 'hidden'` maps to `layer.masksToBounds = YES` on iOS, which
        clips the layer's own shadow — so `glow()` on the pill was dead style
        there, and the bar had no drop shadow on the platform the token was
        written for. The pill still needs the clip (it holds a BlurView and four
        gradients), so the shadow moves out one level. Same split the paywall CTA
        already uses: glow on `ctaWrap`, clip on `cta`.
      */}
      <View style={styles.pillShadow}>
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
                hitSlop={TAB_HIT_SLOP}
                style={styles.itemWrap}
              >
                {/*
                  Every tab is labelled, and the switch is instant.
                
                  This used to label ONLY the active item, which is what made it
                  wider, which is what the travelling-pill `LinearTransition` was
                  animating. Three of the four tabs were therefore a bare icon —
                  `scan-outline`, `person-outline`, `flame-outline` — and a
                  first-run user had to guess. VoiceOver was always fine; sighted
                  discoverability was not, and HIG asks that tab items be labelled.
                
                  Stacking icon over label is what makes four labels fit (see
                  `itemPad` above). It also removes the width difference the layout
                  animation existed to smooth, so that animation is gone rather
                  than left as a no-op — and an instant colour change on tab switch
                  is what iOS does anyway.
                */}
                <View
                  style={[
                    focused ? styles.itemActive : styles.item,
                    { paddingHorizontal: itemPad },
                  ]}
                >
                  {focused && (
                    <LinearGradient
                      colors={[palette.violetDeep, palette.violet]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  )}
                  <Ionicons
                    name={focused ? icons.filled : icons.outline}
                    size={19}
                    color={focused ? palette.textPrimary : palette.textTertiary}
                  />
                  <Text
                    style={focused ? styles.labelActive : styles.label}
                    numberOfLines={1}
                    /* Chrome is capped, content is not — see docs §3.3. Past ~1.3
                       the labels would force the pill wider than a small phone. */
                    maxFontSizeMultiplier={1.3}
                  >
                    {label}
                  </Text>
                </View>
              </HapticPressable>
            );
          })}
        </View>
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
  /** Carries the shadow only — no clip, or the shadow is clipped away. */
  pillShadow: {
    borderRadius: radii.full,
    ...glow(palette.black, 0.55, 18),
  },
  pill: {
    flexDirection: 'row',
    padding: 5,
    gap: 4,
    borderRadius: radii.full,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
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
  /*
   * Icon over label. `paddingVertical: 8` + 19pt icon + 3pt gap + a 14pt line box
   * is a 52pt item; the pill adds 5pt each side for 62, which is `TAB_BAR_HEIGHT`
   * in layout.ts — keep the two in step or
   * every screen's bottom clearance drifts away from the bar it is clearing.
   */
  item: {
    alignItems: 'center',
    gap: 3,
    paddingVertical: 8,
    borderRadius: radii.full,
  },
  itemActive: {
    alignItems: 'center',
    gap: 3,
    paddingVertical: 8,
    borderRadius: radii.full,
    // Clips the gradient to the pill's radius; the gradient is absolutely filled.
    overflow: 'hidden',
  },
  /*
   * Mirrors ActionRail's rail-button label — `overline` with the tracking and the
   * uppercase taken back off. 11pt is the iOS tab-label band.
   */
  label: {
    ...typo.overline,
    letterSpacing: 0,
    textTransform: 'none',
    fontWeight: '600',
    color: palette.textTertiary,
  },
  labelActive: {
    ...typo.overline,
    letterSpacing: 0,
    textTransform: 'none',
    fontWeight: '700',
    color: palette.textPrimary,
  },
});
