import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { absoluteFill, palette } from '@/theme/tokens';

/**
 * The animated splash — "spark ignition", cold launch only.
 *
 * The native splash cannot animate; `expo-splash-screen` shows one static PNG.
 * So this is a JS overlay that takes over from it, and the ONLY thing that
 * makes the handoff invisible is that its first frame is pixel-identical to the
 * native one: same `#0A0A12` ground, same `splash-icon.png`, same `LOGO = 150`
 * width, same centre. **All four of those are duplicated from the
 * `expo-splash-screen` plugin block in `app.json` and have to be changed
 * together** — change one and the logo visibly jumps at the handoff, which
 * reads as a rendering bug rather than as an animation.
 *
 * Sequence, ~2.25s end to end:
 *
 *   0ms     logo centred, matching the native splash exactly
 *   80ms    ✨ bloom pulses out of it, and the logo takes one small pop
 *   300ms   bloom keeps expanding and fading; logo slides left into the lockup
 *   520ms   wordmark resolves out of the fading bloom
 *   950ms   SETTLE — the lockup is finished and holds, still, for HOLD_MS
 *   1950ms  the overlay fades over FADE_MS…
 *   2250ms  …revealing the gate, which has been mounted underneath the whole time
 *
 * The violet bloom is the same visual language as the ✨ overlay button in the
 * product and on the demo page of `welcome.tsx` — the splash shows you the
 * gesture the whole app is built around before you have seen the app.
 *
 * The wordmark is a PNG, not a font. Clash Display is free for commercial use
 * in apps, but its EULA forbids modifying the font software (so no subsetting)
 * and permits embedding only in read-only documents — while explicitly allowing
 * you to "use the Font Software to create logos and other graphic elements
 * [and] static images". A rendered wordmark is squarely inside that grant; a
 * `.ttf` shipped inside an APK, extractable, is not clearly inside it. It is
 * also the better build: `expo-font` loads asynchronously, and a font load
 * gating the splash animation would make the splash longer to make it prettier.
 * Regenerate with `docs/wordmark.py` if the name or weight ever changes.
 */

/** Must equal `imageWidth` in the expo-splash-screen plugin block in app.json. */
const LOGO = 150;
/** Rendered size of the wordmark, and its intrinsic aspect (829×111 source). */
const NAME_H = 30;
const NAME_RATIO = 7.4685;
const NAME_W = NAME_H * NAME_RATIO;

/**
 * The gap you actually SEE between the mark and the wordmark.
 *
 * It is not the margin, and that distinction is the whole reason this constant
 * exists. `splash-icon.png` is a 512×512 canvas with the mark inset — its alpha
 * bounding box is (75, 39)–(432, 471), so **80px of the 512, a full 15.6%, is
 * transparent padding on the right edge alone**. At `LOGO = 150` that is 23pt
 * of nothing between the visible mark and where the layout thinks the logo
 * ends, so a 14pt margin rendered as a ~37pt hole and the lockup read as two
 * unrelated objects.
 *
 * The wordmark has no such slack: `docs/wordmark.py` crops to the alpha bbox,
 * so its left edge is ink.
 *
 * `LAYOUT_GAP` comes out negative, which is correct — it pulls the wordmark
 * back across the icon's dead margin. Re-export the icon with different padding
 * and `ICON_PAD_RIGHT` has to be re-measured; the one-liner is in the git log
 * for this change.
 */
const ICON_PAD_RIGHT = 80 / 512;
const GAP = 12;
const LAYOUT_GAP = GAP - LOGO * ICON_PAD_RIGHT;

const LOCKUP_W = LOGO + LAYOUT_GAP + NAME_W;
/** Breathing room either side of the finished lockup on the narrowest phone. */
const MARGIN = 48;

/*
 * The lockup is centred as a whole, so the logo has to START offset to the
 * right by half of everything that will appear beside it — that is what makes
 * it read as centred-alone on the first frame, and it is the same distance it
 * travels back. Derived, not eyeballed: a hardcoded number drifts the moment
 * the wordmark size or the gap changes.
 */
const SHIFT = (LAYOUT_GAP + NAME_W) / 2;

/*
 * The three numbers that set how long the app waits before it is usable.
 *
 * `SETTLE_MS` is when the animation is finished — the wordmark has landed and
 * nothing is still moving. It is derived: the last thing to start is `name` at
 * 520ms over 420ms. Change either and change this.
 *
 * `HOLD_MS` is the deliberate pause on the finished lockup. It is the only one
 * of the three that is a taste decision rather than a consequence, so it is the
 * one to turn. **Turn it down, not up, if anything.** This runs on every cold
 * launch, so it is a tax the same user pays hundreds of times, and it is the
 * gap between tapping the icon and being able to do anything — nothing below is
 * waiting on it, the gate is already mounted and painted behind the overlay.
 */
const SETTLE_MS = 950;
const HOLD_MS = 1000;
const FADE_MS = 300;

export function SplashIntro({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  /*
   * The finished lockup is ~390pt wide and does not fit a phone, but the logo
   * cannot simply be drawn smaller — its first frame has to match the native
   * splash at exactly `LOGO`. So the whole lockup scales down DURING the slide:
   * the handoff frame is still 1.0, and by the time it is scaled the thing is
   * visibly in motion, so it reads as part of the animation rather than as a
   * resize. Clamped at 1 so a tablet never magnifies it.
   */
  const fit = Math.min(1, (width - MARGIN) / LOCKUP_W);

  /** 0 → 1 across the bloom's whole life. Drives scale AND opacity, because the
   *  bloom must keep expanding while it fades — a `withSequence` back to 0
   *  would shrink it again, which reads as a retreat rather than a burst. */
  const burst = useSharedValue(0);
  /** 1 → 0: the logo's journey back into the lockup. Also drives `fit`. */
  const shift = useSharedValue(1);
  /** The logo's one small pop as the spark leaves it. */
  const pop = useSharedValue(1);
  const name = useSharedValue(0);
  const out = useSharedValue(1);

  useEffect(() => {
    /*
     * Hide the native splash from HERE, not from the gate screens.
     *
     * This overlay is mounted above the navigator, so it is what the user is
     * looking at; if `welcome.tsx` lifted the splash first there would be a
     * frame of whatever the navigator had painted before this covered it.
     * `welcome.tsx` and `account.tsx` still call it too — theirs is the
     * fallback for any launch that skips the intro, and hiding an
     * already-hidden splash rejects harmlessly.
     */
    void SplashScreen.hideAsync().catch(() => {});

    /*
     * Reduce Motion: show the finished lockup, hold, fade. Same `HOLD_MS` as
     * everyone else, but with no `SETTLE_MS` in front of it — there is nothing
     * to settle. So the user still gets the brand beat, and gets into the app
     * sooner rather than later, which is the correct direction for a setting
     * that exists to remove animation rather than to sit through it.
     */
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) {
        shift.value = 0;
        name.value = 1;
        out.value = withDelay(
          HOLD_MS,
          withTiming(0, { duration: FADE_MS }, (done) => done && runOnJS(onDone)()),
        );
        return;
      }

      burst.value = withDelay(80, withTiming(1, { duration: 820, easing: Easing.out(Easing.quad) }));

      /*
       * Both springs are OVERDAMPED on purpose — damping ratio just above 1, so
       * they glide to rest and stop, with no overshoot and no wobble.
       *
       * ζ = damping / (2·√stiffness) at reanimated's default mass of 1. The
       * previous values were ζ≈0.95 for the slide and ζ≈0.47 for the pop, both
       * under 1, so both rang: the logo passed its mark and came back, and the
       * mark bounced. On a splash the eye has nothing else to look at and reads
       * that as the layout settling late rather than as personality.
       *
       * The pop's peak came down with them (1.07 → 1.04): the spark is what is
       * meant to carry that beat, and a mark that visibly inflates competes
       * with it.
       */
      pop.value = withSequence(
        withDelay(80, withTiming(1.04, { duration: 170, easing: Easing.out(Easing.quad) })),
        // ζ ≈ 1.06
        withSpring(1, { damping: 30, stiffness: 200 }),
      );
      // ζ ≈ 1.10
      shift.value = withDelay(300, withSpring(0, { damping: 24, stiffness: 120 }));
      name.value = withDelay(500, withTiming(1, { duration: 440, easing: Easing.out(Easing.cubic) }));

      /*
       * The one callback that ends the intro. It rides the fade-out rather than
       * a `setTimeout` so it cannot fire while the overlay is still opaque —
       * unmounting mid-fade would snap the app in rather than reveal it.
       */
      out.value = withDelay(
        SETTLE_MS + HOLD_MS,
        withTiming(0, { duration: FADE_MS }, (done) => done && runOnJS(onDone)()),
      );
    });
  }, [burst, shift, pop, name, out, onDone]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: out.value }));
  const lockupStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(shift.value, [1, 0], [1, fit]) }],
  }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.18, 0.5, 1], [0, 0.55, 0.32, 0]),
    transform: [{ scale: interpolate(burst.value, [0, 1], [0.35, 3.1]) }],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value * SHIFT }, { scale: pop.value }],
  }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: name.value,
    // Short travel, and shorter than the old 14: the wordmark now starts close
    // to its final position, so a long slide would have it drifting in from
    // somewhere it was never going to be.
    transform: [{ translateX: interpolate(name.value, [0, 1], [8, 0]) }],
  }));

  return (
    <Animated.View
      style={[absoluteFill, styles.overlay, overlayStyle]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.lockup, lockupStyle]}>
        {/* Inside the logo's animated wrapper, so the spark travels WITH the
            mark it came out of rather than staying behind in dead space. */}
        <Animated.View style={logoStyle}>
          <Animated.View style={[styles.bloom, bloomStyle]} pointerEvents="none" />
          <Image
            source={require('@/assets/icons/splash-icon.png')}
            style={styles.logo}
            contentFit="contain"
            /* No fade: the native splash has this exact image on screen already,
               so transitioning it in would blink the one thing that must not. */
            transition={0}
          />
        </Animated.View>

        <Animated.View style={[styles.name, nameStyle]}>
          <Image
            source={require('@/assets/icons/wordmark.png')}
            style={styles.nameImage}
            contentFit="contain"
            transition={0}
          />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** `backgroundColor` must equal the one in the app.json splash plugin block. */
  overlay: {
    backgroundColor: palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  lockup: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: LOGO, height: LOGO },
  // Absolutely positioned and centred on the logo box, so its 3× growth never
  // reflows the row. Declared before the logo, so it renders behind it.
  bloom: {
    // `absoluteFill` from tokens, not StyleSheet.absoluteFillObject — RN 0.86
    // removed that.
    ...absoluteFill,
    borderRadius: LOGO / 2,
    backgroundColor: palette.violet,
  },
  name: { marginLeft: LAYOUT_GAP },
  nameImage: { width: NAME_W, height: NAME_H },
});
