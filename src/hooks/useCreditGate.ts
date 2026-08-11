import { router } from 'expo-router';
import { useCallback } from 'react';

import { track, type EngineName, type PaywallSource } from '@/services/analytics';
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
 *
 * `engine` is what the user was TRYING to do when the gate bit. It is optional
 * because the gate has one caller that is not a tool (the pending-capture path
 * in `profile.tsx` gates a screenshot the bubble already took), and forcing a
 * value there would mean inventing one.
 */
export function useCreditGate(): (source: PaywallSource, engine?: EngineName) => boolean {
  const outOfCredits = useOutOfCredits();

  return useCallback(
    (source: PaywallSource, engine?: EngineName) => {
      if (!outOfCredits) return false;
      /*
       * Logged HERE rather than in `paywall.tsx`, and it is not a duplicate of
       * `paywall_viewed`.
       *
       * This is the moment the free tier REFUSED someone. `paywall_viewed` is
       * the moment they looked at the offer. They are different numbers and the
       * gap between them is the population who hit the wall and did not even
       * read the pitch — which is the single most useful thing to know when
       * deciding how big the free tier should be.
       *
       * Same choke-point argument as the rest of this hook: at the four call
       * sites this would drift, and the last freemium rule that lived at its
       * call sites cost every free user a third of their trial.
       */
      if (engine) track({ name: 'credits_exhausted', engine });
      haptic.warning();
      router.push(`/paywall?source=${source}`);
      return true;
    },
    [outOfCredits],
  );
}
