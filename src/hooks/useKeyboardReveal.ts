import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  TextInput,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

/** Gap left between the focused field and the top of the keyboard. */
const MARGIN = 16;

/**
 * **This whole hook is the ANDROID half, and only the Android half.**
 *
 * iOS already does both jobs natively through `automaticallyAdjustKeyboardInsets`,
 * which both screens set: it adds `contentInset.bottom = keyboardHeight` AND scrolls
 * the focused field clear, on the keyboard's own animation curve. Running this
 * alongside it did the same two things a second time — roughly two keyboard heights
 * of dead scrollable space under the last field, plus a `scrollTo` racing the
 * platform's 50ms later, which reads as a double jolt.
 *
 * The docblocks on both screens already said the manual path exists *because*
 * Android has none. This is that sentence, enforced.
 *
 * Both call sites take `inset` as `kbInset` and branch on `kbInset > 0`, so
 * returning 0 here is all it takes — they fall back to their non-keyboard padding
 * with no change at either site.
 */
const MANUAL = Platform.OS === 'android';

/**
 * How much of the screen the keyboard covers. Added as `paddingBottom` so the
 * ScrollView has somewhere to scroll TO.
 *
 * ⚠️ `automaticallyAdjustKeyboardInsets` is iOS-only, and edge-to-edge (SDK 54+/
 * RN 0.86) stopped Android resizing its window — so Android has no keyboard
 * handling but this. iOS takes `keyboardWillShow` (fires with the animation);
 * Android has no `will` events. AGENTS.md § Conventions, keyboard fix.
 */
function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!MANUAL) return;
    // Android has no `will` events, so `did` is the only option here.
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

/**
 * Scrolls the focused text field out from behind the keyboard. Padding alone
 * only opens room to scroll to — nothing on Android ever scrolls there.
 *
 * Watches focus AND inset: tapping a lower field while the keyboard is already
 * open fires no keyboard event. Measures the focused node rather than
 * `scrollToEnd`, which would over-scroll every field above the last one.
 *
 * ponytail: measures on a callback rather than tracking the keyboard frame, so
 * the scroll lands in one step after the keyboard settles. Good enough at 250ms;
 * reach for `useAnimatedKeyboard` (reanimated is already here) if it reads as a
 * jolt.
 */
export function useKeyboardReveal(scrollRef: React.RefObject<ScrollView | null>) {
  const inset = useKeyboardInset();
  /*
   * Live, not `Dimensions.get('window')`. That was a one-shot read, so the
   * keyboard top was computed against a stale screen height after a rotation or
   * an iPad Split View resize and the field scrolled to the wrong place. Every
   * other screen already reads this through `useLayout()`.
   */
  const { height: windowHeight } = useWindowDimensions();
  /** Bumped by every focus, so re-focusing a field re-runs the measure. */
  const [focusTick, setFocusTick] = useState(0);
  /** Live scroll position — `scrollTo` takes an absolute y, not a delta. */
  const offset = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const onFocus = useCallback(() => setFocusTick((t) => t + 1), []);

  useEffect(() => {
    // `inset` is already 0 on iOS, but be explicit: this effect is the second
    // half of the double-adjust and must not run where the platform reveals.
    if (!MANUAL || inset <= 0) return;
    /*
     * Read on the tick rather than passed in: `onFocus` fires before the field
     * is the focused one as far as TextInput.State is concerned on some
     * versions, and the keyboard-driven run has no event to carry a target at
     * all. Asking who has focus covers both.
     */
    const node = TextInput.State.currentlyFocusedInput();
    if (!node) return;

    /*
     * A frame of slack. On the keyboard-open path the inset arrives from
     * `keyboardDidShow`, and the extra `paddingBottom` it causes has not been
     * laid out yet — measuring in the same tick computes a scroll target the
     * content is not tall enough to reach, and it clamps to a short scroll.
     */
    const t = setTimeout(() => {
      node.measureInWindow((_x, y, _w, h) => {
        const keyboardTop = windowHeight - inset;
        const overlap = y + h + MARGIN - keyboardTop;
        if (overlap <= 0) return;
        scrollRef.current?.scrollTo({ y: offset.current + overlap, animated: true });
      });
    }, 50);
    return () => clearTimeout(t);
  }, [inset, focusTick, scrollRef, windowHeight]);

  return { inset, onFocus, onScroll };
}
