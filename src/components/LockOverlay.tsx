import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { CONTENT_MAX, useLayout } from '@/theme/layout';
import { absoluteFill, glow, palette, radii, spacing } from '@/theme/tokens';
import { HapticPressable } from './HapticPressable';

interface LockOverlayProps {
  onUnlock: () => void;
  onRestore: () => void;
}

/** Full-screen frosted gate shown when the free swipe allowance runs dry. */
export function LockOverlay({ onUnlock, onRestore }: LockOverlayProps) {
  const { gutter } = useLayout();
  return (
    <Animated.View entering={FadeIn.duration(320)} style={StyleSheet.absoluteFill}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.veil} />

      {/* Scrolls because it must survive a landscape phone: at ~390pt tall the
          icon, headline, body and both CTAs no longer fit, and a centred flex
          box would simply clip the restore link. `alignSelf: stretch` on the CTA
          also meant a 1024pt-wide button on a tablet — hence the width cap. */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: Math.max(gutter, spacing.xxl) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <LinearGradient
            colors={[palette.gold, palette.ember]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconGradient}
          >
            <View style={styles.iconInner}>
              <Ionicons name="lock-closed" size={30} color={palette.gold} />
            </View>
          </LinearGradient>
        </View>

        <Text style={styles.title}>That's all the free heat</Text>
        <Text style={styles.body}>
          You've torched your 10 free swipes. Unlock the full arsenal — unlimited lines, unlimited
          reads, zero mercy.
        </Text>

        <HapticPressable
          feedback="medium"
          onPress={onUnlock}
          accessibilityLabel="Unlock RizzCoach Pro"
          style={styles.ctaWrap}
        >
          <LinearGradient
            colors={[palette.violetDeep, palette.violet, palette.pink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cta}
          >
            <Ionicons name="flash" size={17} color={palette.textPrimary} />
            <Text style={styles.ctaText}>Unlock Unlimited</Text>
          </LinearGradient>
        </HapticPressable>

        <HapticPressable
          feedback="none"
          onPress={onRestore}
          accessibilityLabel="Restore purchases"
          hitSlop={10}
        >
          <Text style={styles.restore}>Restore purchases</Text>
        </HapticPressable>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  veil: {
    ...absoluteFill,
    backgroundColor: 'rgba(7,7,11,0.6)',
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    marginBottom: spacing.sm,
    ...glow(palette.gold, 0.5, 26),
  },
  iconGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    padding: 2,
  },
  iconInner: {
    flex: 1,
    borderRadius: 38,
    backgroundColor: '#141422',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: palette.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: 14.5,
    lineHeight: 21,
    color: palette.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  ctaWrap: {
    marginTop: spacing.lg,
    borderRadius: radii.full,
    overflow: 'hidden',
    alignSelf: 'stretch',
    maxWidth: CONTENT_MAX,
    width: '100%',
    ...glow(palette.violet, 0.55, 22),
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: palette.textPrimary,
  },
  restore: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textTertiary,
    padding: spacing.sm,
  },
});
