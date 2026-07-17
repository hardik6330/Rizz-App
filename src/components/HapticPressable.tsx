import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptic } from '@/utils/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface HapticPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Pressed-state scale target. */
  scaleTo?: number;
  feedback?: 'light' | 'medium' | 'none';
  children?: React.ReactNode;
}

/**
 * The app's base touchable: spring scale-down on press + haptic tick.
 * Every interactive element routes through this so touch feel is consistent.
 */
export function HapticPressable({
  style,
  scaleTo = 0.96,
  feedback = 'light',
  onPressIn,
  onPressOut,
  ...rest
}: HapticPressableProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(event) => {
        scale.value = withSpring(scaleTo, { damping: 18, stiffness: 420 });
        if (feedback !== 'none') haptic[feedback]();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, { damping: 18, stiffness: 420 });
        onPressOut?.(event);
      }}
    />
  );
}
