import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How much of the screen the software keyboard is currently covering.
 *
 * ## The bug this exists for
 *
 * Both screens with text inputs set `automaticallyAdjustKeyboardInsets` on their
 * ScrollView and left it there. **That prop is iOS-only.** On Android nothing was
 * handling the keyboard at all, so the last field on the page — the password on
 * `account.tsx` — sat underneath it with no way to scroll to it. The page could
 * not scroll further because its content ended exactly where the keyboard began.
 *
 * It used to work by accident, via the platform: `adjustResize` shrank the whole
 * window when the keyboard opened, so the ScrollView simply got shorter and
 * scrolling worked. Under the edge-to-edge display that Expo SDK 54+ and RN 0.86
 * enforce on Android, the window no longer resizes — the keyboard arrives as an
 * inset that somebody has to read and account for. Nobody was.
 *
 * ## What this does
 *
 * Returns the keyboard height, to be added as extra `paddingBottom` on the
 * scroll content. That gives the ScrollView somewhere to scroll TO — which is
 * why this is a number and not a wrapper component: `KeyboardAvoidingView` would
 * have to own the layout to do the same job, and it is famously unreliable on
 * Android precisely because it is guessing at what this reports directly.
 *
 * ⚠️ **Room to scroll into is not the same as scrolling into it.** This used to
 * claim "the platform's own reveal-the-focused-input behaviour does the rest".
 * It does not, and could not: that reveal is a side effect of `adjustResize`
 * shrinking the window, which is the exact behaviour edge-to-edge removed and
 * the reason this hook exists. The padding was opening up empty space that
 * nothing ever scrolled to, so the password field stayed under the keyboard.
 * **Use `useKeyboardReveal`, which wraps this and does the scrolling.** Reach
 * for this one directly only on a screen whose inputs cannot be occluded.
 *
 * ## Why not a library
 *
 * `react-native-keyboard-controller` is the usual answer and would animate this
 * frame-for-frame with the keyboard. It is also a native module, so adopting it
 * means a rebuild and a new dependency to carry, for a difference visible only
 * during a 250ms transition on two screens. `Keyboard` is in React Native
 * itself, fires on both platforms, and needs no native change at all.
 *
 * ponytail: the padding appears in one step rather than tracking the keyboard's
 * slide. Swap the listeners for reanimated's `useAnimatedKeyboard` (reanimated
 * is already a dependency) if that step ever reads as a jolt.
 */
export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    /*
     * `keyboardWillShow` on iOS fires with the animation and lands in the same
     * frame as the keyboard; Android has no `will` events at all, so it takes
     * `did`. Using `did` on both would make iOS visibly late.
     */
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
