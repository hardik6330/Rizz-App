import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { palette, radii, spacing } from '@/theme/tokens';
import { HapticPressable } from './HapticPressable';

interface ProUpsellCardProps {
  onPress: () => void;
}

/** Inline upsell shown on the Lab tab once free analyses run out. */
export function ProUpsellCard({ onPress }: ProUpsellCardProps) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(17)}>
      <LinearGradient
        colors={[`${palette.gold}66`, `${palette.ember}44`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.border}
      >
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="diamond" size={20} color={palette.gold} />
          </View>
          <View style={styles.body}>
            <Text style={styles.title}>That was your last free read</Text>
            <Text style={styles.sub}>Unlimited breakdowns, roasts and simulations with Pro.</Text>
          </View>
          <HapticPressable onPress={onPress} accessibilityLabel="Open RizzCoach Pro paywall" style={styles.cta}>
            <Text style={styles.ctaText}>Go Pro</Text>
          </HapticPressable>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  border: {
    borderRadius: radii.lg + 1,
    padding: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#171226',
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.gold}1A`,
    borderWidth: 1,
    borderColor: `${palette.gold}55`,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: palette.textPrimary,
  },
  sub: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.textSecondary,
  },
  cta: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.full,
    backgroundColor: palette.gold,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1A1406',
  },
});
