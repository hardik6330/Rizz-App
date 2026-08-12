import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Plan } from '@/services/purchases';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';
import { HapticPressable } from '@/components/ui/HapticPressable';

interface PlanCardProps {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}

/** Selectable subscription plan row on the paywall. */
export function PlanCard({ plan, selected, onSelect }: PlanCardProps) {
  return (
    <View style={styles.slot}>
      <HapticPressable
        feedback="none"
        onPress={() => {
          haptic.selection();
          onSelect();
        }}
        accessibilityRole="radio"
        accessibilityLabel={`${plan.title} plan, ${plan.price} ${plan.period}`}
        accessibilityState={{ selected }}
      >
        <LinearGradient
          colors={selected ? [palette.violet, palette.pink] : ['transparent', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.border}
        >
          <View style={[styles.card, selected && styles.cardSelected]}>
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected && <Ionicons name="checkmark" size={13} color={palette.textPrimary} />}
            </View>
            <View style={styles.info}>
              <Text style={styles.title}>{plan.title}</Text>
              {plan.sub != null && <Text style={styles.sub}>{plan.sub}</Text>}
            </View>
            <View style={styles.priceCol}>
              <Text style={styles.price} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {plan.price}
              </Text>
              <Text style={styles.period} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {plan.period}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </HapticPressable>
      {plan.badge != null && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{plan.badge}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'relative',
  },
  border: {
    borderRadius: radii.lg + 1.5,
    padding: 1.5,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
  },
  cardSelected: {
    backgroundColor: '#191329',
    borderColor: 'transparent',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: palette.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: palette.violet,
    backgroundColor: palette.violet,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typo.h3,
    fontWeight: '800',
  },
  sub: {
    ...typo.caption,
    fontWeight: '400',
  },
  priceCol: {
    alignItems: 'flex-end',
    // Fixed content beside a flex column: shrink the title, never the price.
    flexShrink: 0,
    gap: 1,
  },
  price: {
    ...typo.h3,
    fontWeight: '800',
  },
  period: {
    ...typo.overline,
    letterSpacing: 0,
    textTransform: 'none',
    fontWeight: '400',
    color: palette.textTertiary,
  },
  badge: {
    position: 'absolute',
    top: -9,
    right: 14,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: palette.gold,
  },
  badgeText: {
    ...typo.micro,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#1A1406',
  },
});
