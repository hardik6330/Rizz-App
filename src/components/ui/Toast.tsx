import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLayout } from '@/theme/layout';
import { EXIT } from '@/theme/motion';
import { glow, palette, radii, semantic, spacing, type as typo } from '@/theme/tokens';

/**
 * What happened, which decides the icon and its colour.
 *
 * There was no such thing until now: the pill hardcoded a mint `checkmark-circle`
 * for every message it was ever given, so `'The engine choked — try again'` and
 * `'No previous purchases found'` were both announced with a green success tick.
 * Contradicting yourself at the one moment the user needs to understand
 * something went wrong is worse than saying nothing.
 */
const TONES = {
  success: { icon: 'checkmark-circle', color: semantic.success },
  error: { icon: 'alert-circle', color: semantic.error },
  info: { icon: 'information-circle', color: semantic.info },
} as const satisfies Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }>;

export type ToastTone = keyof typeof TONES;

/** The `show` signature, for components handed the toast as a prop. */
export type ShowToast = (msg: string, opts?: { tone?: ToastTone; durationMs?: number }) => void;

/**
 * Screen-local toast. Usage:
 *   const toast = useToast();
 *   toast.show('Copied');
 *   toast.show('That did not work', { tone: 'error' });
 *   ...render {toast.element} as the last child of the screen root.
 *
 * `tone` defaults to success so no existing call site changed meaning — the
 * failures were found and moved over by hand rather than by flipping the default
 * and hoping.
 */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<ToastTone>('success');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  // The old flat 112 sat *on* the floating tab bar on devices with a tall
  // bottom inset. Clear the bar's own geometry instead.
  const bottom = Math.max(insets.bottom, 14) + 92;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback(
    (msg: string, opts: { tone?: ToastTone; durationMs?: number } = {}) => {
      setMessage(msg);
      setTone(opts.tone ?? 'success');
      if (timer.current) clearTimeout(timer.current);
      // Errors sit longer: they are usually longer to read, and unlike "Copied"
      // they are telling the user to do something rather than confirming a thing
      // they just did.
      const fallback = opts.tone === 'error' ? 2600 : 1700;
      timer.current = setTimeout(() => setMessage(null), opts.durationMs ?? fallback);
    },
    [],
  );

  const element = message ? (
    <View pointerEvents="none" style={[styles.host, { bottom, paddingHorizontal: gutter }]}>
      <Animated.View
        entering={FadeInUp.springify().damping(16)}
        exiting={FadeOut.duration(EXIT)}
        style={styles.toast}
        /*
         * Announced, not just drawn.
         *
         * The host is `pointerEvents="none"` and carries no role, so to a screen
         * reader this pill did not exist — "Copied", "Removed from history" and
         * every error above were silent. `assertive` rather than `polite`
         * because it is transient: it is gone in under three seconds, and a
         * polite announcement queued behind whatever is being read misses its
         * own window.
         */
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        accessible
        accessibilityLabel={message}
      >
        <Ionicons name={TONES[tone].icon} size={16} color={TONES[tone].color} />
        {/* Long messages exist ("that doesn't look like a profile…"): let the
            pill wrap inside the gutter rather than run off both edges. */}
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  ) : null;

  return { show, element };
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.full,
    backgroundColor: 'rgba(27,27,42,0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    ...glow(palette.black, 0.5, 14),
  },
  text: {
    ...typo.label,
    flexShrink: 1,
  },
});
