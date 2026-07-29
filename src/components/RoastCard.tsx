import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { Roast } from '@/types';
import { HapticPressable } from './HapticPressable';

interface RoastCardProps {
  roast: Roast;
  onShare: () => void;
}

/** Brutal, shareable roast of the user's own texting. */
export function RoastCard({ roast, onShare }: RoastCardProps) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(17)}>
      <LinearGradient
        colors={[palette.ember, palette.pink, palette.violet]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.border}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.overline}>🔥 ROAST MODE</Text>
            <Text style={styles.skulls}>{'💀'.repeat(roast.brutality)}</Text>
          </View>

          <Text style={styles.text}>{roast.text}</Text>
          <Text style={styles.tagline}>{roast.tagline}</Text>

          <HapticPressable
            feedback="medium"
            onPress={onShare}
            accessibilityLabel="Share this roast"
            style={styles.shareWrap}
          >
            <LinearGradient
              colors={[palette.ember, palette.pink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.shareButton}
            >
              <Ionicons name="share-outline" size={17} color={palette.textPrimary} />
              <Text style={styles.shareText}>Share this roast</Text>
            </LinearGradient>
          </HapticPressable>
          <Text style={styles.disclaimer}>Warning: may end friendships.</Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  border: {
    borderRadius: radii.lg + 2,
    padding: 1.5,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overline: {
    ...typo.overline,
    flexShrink: 1,
    color: palette.ember,
  },
  skulls: {
    fontSize: 13,
    letterSpacing: 1,
  },
  text: {
    fontSize: 16,
    lineHeight: 25,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  tagline: {
    fontSize: 13,
    fontStyle: 'italic',
    color: palette.textTertiary,
  },
  shareWrap: {
    borderRadius: radii.full,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
  },
  shareText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: palette.textPrimary,
  },
  disclaimer: {
    fontSize: 11,
    color: palette.textTertiary,
    textAlign: 'center',
  },
});
