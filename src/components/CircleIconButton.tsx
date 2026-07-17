import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/theme/tokens';
import { HapticPressable } from './HapticPressable';

interface CircleIconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: number;
  color?: string;
  active?: boolean;
  activeColor?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
}

/** Small round icon button used across cards, headers and rails. */
export function CircleIconButton({
  icon,
  onPress,
  size = 36,
  color = palette.textSecondary,
  active = false,
  activeColor = palette.violet,
  style,
  accessibilityLabel,
}: CircleIconButtonProps) {
  return (
    <HapticPressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2 },
        active && { borderColor: `${activeColor}66`, backgroundColor: `${activeColor}1F` },
        style,
      ]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={active ? activeColor : color} />
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
  },
});
