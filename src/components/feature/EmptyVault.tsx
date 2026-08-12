import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { glow, palette, radii, spacing, type as typo } from '@/theme/tokens';
import { Button } from '@/components/ui/Button';

interface EmptyVaultProps {
  onBrowse: () => void;
}

/** Empty state for the vault with a nudge toward the Discovery feed. */
export function EmptyVault({ onBrowse }: EmptyVaultProps) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name="bookmark" size={34} color={palette.violetBright} />
      </View>
      <Text style={styles.title}>Your vault is empty</Text>
      <Text style={styles.body}>
        Save the lines that hit different —{'\n'}they&apos;ll live here forever.
      </Text>
      <Button
        label="Go find some heat"
        icon="flame"
        variant="ghost"
        size="md"
        onPress={onBrowse}
        accessibilityLabel="Browse the Discovery feed"
        style={styles.cta}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl + 16,
    gap: spacing.md,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.violet}17`,
    borderWidth: 1,
    borderColor: `${palette.violet}3D`,
    marginBottom: spacing.sm,
    ...glow(palette.violet, 0.4, 24),
  },
  title: {
    ...typo.h2,
  },
  body: {
    ...typo.bodyMuted,
    textAlign: 'center',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: radii.full,
    backgroundColor: `${palette.violet}1F`,
    borderWidth: 1,
    borderColor: `${palette.violet}66`,
  },
});
