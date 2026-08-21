import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isSupported } from '@/../modules/profile-capture';

import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { Dot, LegalLinks, Link } from '@/components/ui/LegalLinks';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { PlanCard } from '@/components/feature/PlanCard';
import { useToast } from '@/components/ui/Toast';
import { BG } from '@/data/assets';
import { track, type PaywallSource } from '@/services/analytics';
import { fetchPlans, purchasePlan, restorePurchases, type Plan } from '@/services/purchases';
import { CONTENT_MAX, useLayout } from '@/theme/layout';
import { duration } from '@/theme/motion';
import { glow, palette, radii, spacing, type as typo } from '@/theme/tokens';
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
  /*
   * ⚠️ The bubble line is ANDROID ONLY, and this is the rule above being applied
   * rather than an optimisation.
   *
   * `isSupported` is `Platform.OS === 'android' && native != null` — the bubble is
   * an accessibility service and iOS has no equivalent. Rendering this line on an
   * iPhone sold a capability the binary cannot deliver, which is App Store Review
   * 2.3.1 and a refund request from anyone who bought on the strength of it. Two
   * other lines were cut from this list for the same reason; this one hid because
   * it IS true on the platform the app was built on first.
   *
   * Module scope, so it costs nothing at render — `isSupported` is a const.
   *
   * **Do not backfill a fourth iOS line.** The obvious candidate is the home-screen
   * widget, and the widget is free — putting it here would break the rule above in
   * the other direction. Three true lines beat four with a lie in them.
   */
  ...(isSupported
    ? [{ icon: 'sparkles' as const, text: 'Unlimited one-tap replies from the ✨ bubble' }]
    : []),
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
    return () => {
      mounted = false;
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
      toast.show('No previous purchases found', { tone: 'info' });
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

        {/*
          A capability claim, not social proof.

          This was "★ 4.9 · Loved by 120k+ hopeless romantics" over three of the
          generated AVATARS portraits, presented as customers — on an app that has
          shipped to neither store. Fabricated ratings and testimonials are covered
          by App Store Review 2.3.1 and Play's Misrepresentation policy, and this is
          the screen a reviewer reads hardest. It also contradicted the rule at the
          top of this file: do not put a claim on the purchase screen that the code
          cannot back. Put the numbers back when the numbers are real.
        */}
        <Text style={styles.proofText}>
          Every reply is written from the conversation you upload — never a template.
        </Text>

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

        {/* Legal. Shared with account.tsx and ai-consent.tsx — see LegalLinks. */}
        <LegalLinks>
          <Dot />
          <Link label="Restore purchases" onPress={() => void restore()} />
        </LegalLinks>
      </ScrollView>

      {/*
        Present from the first frame.

        It used to appear on a 1400ms timer. Deliberately withholding the way out
        of a purchase screen is a documented App Store review flag and reads as a
        dark pattern to the user, and the dwell it bought was worth far less than
        having the most-scrutinised screen in the app re-reviewed. If the offer
        needs time to land, earn it with the offer — not with a hidden exit.
      */}
      <Animated.View
        entering={FadeIn.duration(duration.quick)}
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

      {toast.element}
    </View>
  );
}

/** Soft light sweep across the CTA. */
function Shimmer() {
  /**
   * Reduce Motion removes the sweep entirely rather than stopping it.
   *
   * Reanimated defaults to `ReduceMotion.System`, which does not pause a
   * `withRepeat` — it jumps it to its FINAL value and holds. Here that parks a
   * white diagonal streak at the right-hand edge of the CTA, permanently, which
   * reads as a rendering artefact on the one screen that must not look broken.
   * Exactly the failure `AnalyzingOverlay` documents for its scan beam.
   *
   * Returning null is the whole fix: the sweep is decoration on a button that is
   * already legible without it.
   */
  const reduced = useReducedMotion();

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

  if (reduced) return null;

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
    ...typo.display,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  titleAccent: {
    color: palette.gold,
  },
  subtitle: {
    ...typo.bodyMuted,
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
    ...typo.body,
    flex: 1,
    fontWeight: '600',
  },
  proofText: {
    ...typo.caption,
    fontWeight: '600',
    textAlign: 'center',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
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
    ...typo.h3,
    fontWeight: '800',
  },
  shimmer: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    width: 70,
  },
  ctaSub: {
    ...typo.caption,
    color: palette.textTertiary,
    textAlign: 'center',
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
