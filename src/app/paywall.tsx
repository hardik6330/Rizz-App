import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { PlanCard } from '@/components/feature/PlanCard';
import { useToast } from '@/components/ui/Toast';
import { PRIVACY_URL, TERMS_URL } from '@/constants';
import { AVATARS, BG } from '@/data/assets';
import { track, type PaywallSource } from '@/services/analytics';
import { fetchPlans, purchasePlan, restorePurchases, type Plan } from '@/services/purchases';
import { CONTENT_MAX, useLayout } from '@/theme/layout';
import { glow, palette, radii, spacing } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * What Pro ACTUALLY unlocks. Every line here must be false for a free user.
 *
 * Two of these used to be untrue. "Roast Mode + A/B Simulator" are not gated —
 * `index.tsx` renders both for anyone with a credit — and "Fresh lines dropped
 * weekly" described a feed that regenerates DAILY and is free either way. A
 * purchase screen listing things the user already has is the kind of claim a
 * store reviewer reads as misleading and a customer reads as a refund request,
 * and it is worse than a shorter list: it teaches people that the paywall's
 * copy cannot be trusted at the exact moment they are deciding whether to pay.
 *
 * The rule when adding a line: name the gate that enforces it. Unlimited
 * analyses is `useOutOfCredits`; unlimited swipes is `FREE_SWIPE_LIMIT`; the
 * bubble is gated by the same credit pool. If you cannot point at the code that
 * withholds it, it is not a Pro feature and it does not belong on this screen.
 */
const FEATURES: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'infinite', text: 'Unlimited screenshot breakdowns' },
  { icon: 'scan-outline', text: 'Unlimited profile scans & bio rewrites' },
  { icon: 'flame', text: 'Unlimited Discovery swipes' },
  { icon: 'sparkles', text: 'Unlimited one-tap replies from the ✨ bubble' },
];

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  /*
   * Both paywall events are logged HERE, once, rather than at the ten
   * `router.push('/paywall')` call sites — the source rides in as a route param,
   * so a new entry point is attributed for free and the two events can never
   * drift apart. An unrecognised or absent param reads as 'manual'.
   */
  const { source } = useLocalSearchParams<{ source?: PaywallSource }>();
  const entry: PaywallSource = source ?? 'manual';
  const { gutter } = useLayout();
  const toast = useToast();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showClose, setShowClose] = useState(false);
  /** Read in the unmount cleanup, which closes over the first render's state. */
  const convertedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    void fetchPlans().then((fetched) => {
      if (!mounted) return;
      setPlans(fetched);
      setSelectedId(fetched.find((plan) => plan.badge)?.id ?? fetched[0]?.id ?? null);
    });
    track({ name: 'paywall_viewed', source: entry });
    const closeTimer = setTimeout(() => setShowClose(true), 1400);
    return () => {
      mounted = false;
      clearTimeout(closeTimer);
      // Fires on every exit — the ✕, the hardware back button, and the automatic
      // dismissal after a purchase. `converted` is what separates the three.
      track({ name: 'paywall_dismissed', source: entry, converted: convertedRef.current });
    };
  }, [entry]);

  const buy = async () => {
    if (!selectedId || busy || done) return;
    haptic.medium();
    setBusy(true);
    const unlocked = await purchasePlan(selectedId);
    if (unlocked) {
      haptic.success();
      convertedRef.current = true;
      setDone(true);
      setTimeout(() => router.back(), 1200);
    } else {
      haptic.warning();
      setBusy(false);
    }
  };

  const restore = async () => {
    haptic.light();
    const restored = await restorePurchases();
    if (restored) {
      convertedRef.current = true;
      toast.show('Pro restored — welcome back');
      setTimeout(() => router.back(), 900);
    } else {
      toast.show('No previous purchases found');
    }
  };

  return (
    <View style={styles.root}>
      {/* Cinematic backdrop */}
      <Image source={BG.ember} style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} contentFit="cover" />
      <LinearGradient
        colors={['rgba(10,10,18,0.25)', 'rgba(10,10,18,0.88)', palette.ink]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            // Android shows this modal full-screen: without the inset the crown
            // started under the status bar.
            paddingTop: insets.top + spacing.xxl,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Crown — statically visible: the sell screen never depends on animations */}
        <View style={styles.crownWrap}>
          <LinearGradient
            colors={[palette.gold, palette.ember]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.crown}
          >
            <View style={styles.crownInner}>
              <Ionicons name="diamond" size={30} color={palette.gold} />
            </View>
          </LinearGradient>
        </View>

        <Text style={styles.title}>
          RizzCoach <Text style={styles.titleAccent}>Pro</Text>
        </Text>
        <Text style={styles.subtitle}>Unlimited game. Zero guesswork.</Text>

        {/* Features */}
        <View style={styles.features}>
          {FEATURES.map((feature) => (
            <View key={feature.text} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name={feature.icon} size={15} color={palette.violetBright} />
              </View>
              <Text style={styles.featureText}>{feature.text}</Text>
            </View>
          ))}
        </View>

        {/* Social proof */}
        <View style={styles.proofRow}>
          <View style={styles.avatarStack}>
            {[AVATARS.maya, AVATARS.marcus, AVATARS.zara].map((avatar, index) => (
              <Image
                key={index}
                source={avatar}
                style={[styles.proofAvatar, { marginLeft: index === 0 ? 0 : -10 }]}
                contentFit="cover"
              />
            ))}
          </View>
          <Text style={styles.proofText}>★ 4.9 · Loved by 120k+ hopeless romantics</Text>
        </View>

        {/* Plans */}
        <View style={styles.plans}>
          {plans.length === 0
            ? [0, 1].map((index) => <PlanSkeleton key={index} index={index} />)
            : plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  selected={plan.id === selectedId}
                  onSelect={() => setSelectedId(plan.id)}
                />
              ))}
        </View>

        {/* CTA */}
        <HapticPressable
          feedback="none"
          onPress={() => void buy()}
          disabled={busy || done || plans.length === 0}
          accessibilityLabel="Unlock RizzCoach Pro"
          style={[styles.ctaWrap, done && { shadowColor: palette.mint }]}
        >
          <LinearGradient
            colors={
              done
                ? [palette.mint, '#22B87A']
                : [palette.violetDeep, palette.violet, palette.pink]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cta}
          >
            {busy && !done ? (
              <ActivityIndicator color={palette.textPrimary} />
            ) : done ? (
              <>
                <Ionicons name="checkmark-circle" size={19} color={palette.textPrimary} />
                <Text style={styles.ctaText}>Welcome to Pro 🎉</Text>
              </>
            ) : (
              <>
                <Ionicons name="flash" size={17} color={palette.textPrimary} />
                <Text style={styles.ctaText}>Unlock Everything</Text>
              </>
            )}
            {!busy && !done && <Shimmer />}
          </LinearGradient>
        </HapticPressable>
        {/*
          Auto-renewal has to be disclosed ON the purchase screen — App Store
          Review 3.1.2 and Play's subscription policy both require it, and it is
          one of the more common rejections for an app that otherwise passes.
        */}
        <Text style={styles.ctaSub}>
          Auto-renews until cancelled · Cancel anytime in your store settings
        </Text>

        {/* Legal */}
        <View style={styles.legalRow}>
          <HapticPressable feedback="none" hitSlop={8} onPress={() => void Linking.openURL(TERMS_URL)}>
            <Text style={styles.legalText}>Terms</Text>
          </HapticPressable>
          <Text style={styles.legalDot}>·</Text>
          <HapticPressable feedback="none" hitSlop={8} onPress={() => void Linking.openURL(PRIVACY_URL)}>
            <Text style={styles.legalText}>Privacy</Text>
          </HapticPressable>
          <Text style={styles.legalDot}>·</Text>
          <HapticPressable feedback="none" hitSlop={8} onPress={() => void restore()}>
            <Text style={styles.legalText}>Restore purchases</Text>
          </HapticPressable>
        </View>
      </ScrollView>

      {/* Delayed close */}
      {showClose && (
        <Animated.View
          entering={FadeIn.duration(400)}
          style={[styles.close, { top: insets.top + spacing.sm, left: gutter }]}
        >
          <CircleIconButton
            icon="close"
            size={36}
            color={palette.textSecondary}
            onPress={() => router.back()}
            accessibilityLabel="Close paywall"
          />
        </Animated.View>
      )}

      {toast.element}
    </View>
  );
}

/** Soft light sweep across the CTA. */
function Shimmer() {
  const { width, gutter } = useLayout();
  // The sweep has to cross the whole CTA. It was a hardcoded 420, which stopped
  // two thirds of the way across on a tablet and overshot on a small phone.
  const travel = Math.min(width - gutter * 2, CONTENT_MAX) + 60;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withDelay(900, withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) })),
      -1,
      false,
    );
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-120, travel]) },
      { rotate: '18deg' },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.shimmer, style]}>
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.28)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

function PlanSkeleton({ index }: { index: number }) {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withDelay(index * 140, withRepeat(withTiming(1, { duration: 700 }), -1, true));
  }, [index, pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[styles.skeleton, style]} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.ink,
  },
  scroll: {
    gap: spacing.md,
  },
  crownWrap: {
    alignSelf: 'center',
    ...glow(palette.gold, 0.55, 26),
  },
  crown: {
    width: 78,
    height: 78,
    borderRadius: 39,
    padding: 2,
  },
  crownInner: {
    flex: 1,
    borderRadius: 37,
    backgroundColor: '#141422',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 33,
    lineHeight: 39,
    fontWeight: '900',
    letterSpacing: -1,
    color: palette.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  titleAccent: {
    color: palette.gold,
  },
  subtitle: {
    fontSize: 15,
    color: palette.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  features: {
    gap: spacing.md,
    backgroundColor: 'rgba(19,19,30,0.72)',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.lg,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.violet}1F`,
    borderWidth: 1,
    borderColor: `${palette.violet}44`,
  },
  featureText: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  avatarStack: {
    flexDirection: 'row',
  },
  proofAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.ink,
  },
  proofText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  plans: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  ctaWrap: {
    marginTop: spacing.md,
    borderRadius: radii.full,
    ...glow(palette.violet, 0.5, 22),
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 17,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  ctaText: {
    fontSize: 16.5,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: palette.textPrimary,
  },
  shimmer: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    width: 70,
  },
  ctaSub: {
    fontSize: 11.5,
    color: palette.textTertiary,
    textAlign: 'center',
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  legalText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textTertiary,
  },
  legalDot: {
    color: palette.textTertiary,
    fontSize: 12,
  },
  close: {
    position: 'absolute',
  },
  skeleton: {
    height: 74,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceHigh,
  },
});
