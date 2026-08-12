import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';

import { glow, palette, spacing, type as typo } from '@/theme/tokens';
import { HapticPressable } from '@/components/ui/HapticPressable';

interface ActionRailProps {
  saved: boolean;
  onCopy: () => void;
  onToggleSave: () => void;
  onShare: () => void;
  style?: StyleProp<ViewStyle>;
}

/** TikTok-style vertical action rail pinned to the right edge of feed cards. */
export function ActionRail({ saved, onCopy, onToggleSave, onShare, style }: ActionRailProps) {
  return (
    <View style={[styles.rail, style]} pointerEvents="box-none">
      <RailButton icon="copy-outline" label="Copy" onPress={onCopy} accessibilityLabel="Copy line" />
      <RailButton
        icon={saved ? 'bookmark' : 'bookmark-outline'}
        label="Save"
        active={saved}
        activeColor={palette.violetBright}
        onPress={onToggleSave}
        accessibilityLabel={saved ? 'Remove from vault' : 'Save to vault'}
      />
      <RailButton icon="share-outline" label="Share" onPress={onShare} accessibilityLabel="Share line" />
    </View>
  );
}

interface RailButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
  activeColor?: string;
}

function RailButton({
  icon,
  label,
  onPress,
  accessibilityLabel,
  active = false,
  activeColor = palette.violetBright,
}: RailButtonProps) {
  const pop = useSharedValue(1);
  const mounted = useRef(false);

  useEffect(() => {
    // Bounce the icon when the active state flips on (save action).
    if (mounted.current && active) {
      pop.value = withSequence(
        withSpring(1.35, { damping: 9, stiffness: 320 }),
        withSpring(1, { damping: 12, stiffness: 320 }),
      );
    }
    mounted.current = true;
  }, [active, pop]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <View style={styles.item}>
      <HapticPressable
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected: active }}
        style={[
          styles.button,
          active && {
            borderColor: `${activeColor}77`,
            backgroundColor: `${activeColor}26`,
            ...glow(activeColor, 0.55, 14),
          },
        ]}
      >
        <Animated.View style={popStyle}>
          <Ionicons name={icon} size={23} color={active ? activeColor : palette.textPrimary} />
        </Animated.View>
      </HapticPressable>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    right: spacing.md,
    alignItems: 'center',
    gap: spacing.lg + 2,
  },
  item: {
    alignItems: 'center',
    gap: 5,
  },
  button: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(19,19,30,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  label: {
    ...typo.overline,
    letterSpacing: 0,
    textTransform: 'none',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
});
