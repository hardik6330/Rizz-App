import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

/** Gap left between the focused field and the top of the keyboard. */
const MARGIN = 16;

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
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
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
  /** Bumped by every focus, so re-focusing a field re-runs the measure. */
  const [focusTick, setFocusTick] = useState(0);
  /** Live scroll position — `scrollTo` takes an absolute y, not a delta. */
  const offset = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const onFocus = useCallback(() => setFocusTick((t) => t + 1), []);

  useEffect(() => {
    if (inset <= 0) return;
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
        const keyboardTop = Dimensions.get('window').height - inset;
        const overlap = y + h + MARGIN - keyboardTop;
        if (overlap <= 0) return;
        scrollRef.current?.scrollTo({ y: offset.current + overlap, animated: true });
      });
    }, 50);
    return () => clearTimeout(t);
  }, [inset, focusTick, scrollRef]);

  return { inset, onFocus, onScroll };
}
