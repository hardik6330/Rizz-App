import { router } from 'expo-router';
import { useCallback } from 'react';

import { useOutOfCredits } from '@/state/useRizzStore';
import { haptic } from '@/utils/haptics';

/**
 * The free-tier gate, in one place.
 *
 *     const blocked = useCreditGate();
 *     if (blocked('out_of_credits')) return;
 *
 * Returns true when the user has nothing left and has been sent to the paywall,
 * so the caller returns without starting work.
 *
 * This exists for the same reason `useOutOfCredits` and `state/limits.ts` do,
 * and the reason is money. The rule "no credits → haptic → push the paywall with
 * a source" was written out longhand at four call sites, and the last freemium
 * rule that lived at its call sites (`analysisCount`) drifted silently and locked
 * every free user out after two of their three analyses. Three copies of a
 * freemium rule is three chances to drift.
 *
 * `source` is required, not optional: it rides into `/paywall` as a route param
 * and is the ONLY thing attributing a paywall view to what triggered it —
 * `paywall.tsx` logs the event, so a call site that forgets it is a blind spot
 * in the funnel rather than a visible bug.
 */
/** Every entry point the paywall is attributed to. Keep in step with `paywall.tsx`. */
export type PaywallSource = 'out_of_credits' | 'upsell_card' | 'swipe_limit' | 'manual';

export function useCreditGate(): (source: PaywallSource) => boolean {
  const outOfCredits = useOutOfCredits();

  return useCallback(
    (source: PaywallSource) => {
      if (!outOfCredits) return false;
      haptic.warning();
      router.push(`/paywall?source=${source}`);
      return true;
    },
    [outOfCredits],
  );
}
