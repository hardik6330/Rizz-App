import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

import { useKeyboardInset } from './useKeyboardInset';

/** Gap left between the focused field and the top of the keyboard. */
const MARGIN = 16;

/**
 * Scrolls the focused text field out from behind the keyboard.
 *
 * ## The bug this exists for
 *
 * `useKeyboardInset` added the keyboard's height as `paddingBottom`, and its
 * docblock claimed that "the platform's own reveal-the-focused-input behaviour
 * does the rest". **On Android there is no such behaviour to do the rest.** That
 * reveal is a side effect of `adjustResize` shrinking the window, which is
 * exactly what edge-to-edge stopped doing — the same root cause that made the
 * padding necessary in the first place. So the padding opened up somewhere to
 * scroll to and then nothing ever scrolled there: tapping PASSWORD on the signup
 * form put the caret in a field sitting under the keyboard, and the user typed
 * ten characters they could not see.
 *
 * ## Why it needs a focus signal as well as the keyboard height
 *
 * Two different moments hide a field, and only one of them fires a keyboard
 * event. Tapping a field while the keyboard is closed opens it — that is the
 * inset changing. Tapping a *lower* field while the keyboard is already open
 * moves focus under it with no event at all, which is the email → password tap
 * on this very form. Both have to trigger the measure, so `onFocus` goes on the
 * inputs and the effect watches both.
 *
 * ## Why measure instead of scrolling to the end
 *
 * `scrollToEnd` would fix the password field, because it happens to be last, and
 * would over-scroll every field above it. Measuring the field that actually has
 * focus is the same amount of code and does not care about field order.
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
