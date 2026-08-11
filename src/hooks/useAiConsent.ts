import { router } from 'expo-router';
import { useCallback } from 'react';

import { track, type EngineName } from '@/services/analytics';
import { useRizzStore } from '@/state/useRizzStore';
import { haptic } from '@/utils/haptics';

/**
 * The upload-consent gate, in one place.
 *
 *     const needsConsent = useAiConsent();
 *     if (needsConsent('lab')) return;
 *
 * Returns true when the user has not yet agreed that their screenshots may be
 * sent to Google Gemini, and has been shown `/ai-consent` — so the caller
 * returns without starting work.
 *
 * **This is not a paywall and shares nothing with one.** It reads `aiConsent`
 * and nothing else: no credits, no entitlement, no plan. A Pro subscriber is
 * asked exactly like a free user, because the question is whether a private
 * conversation may leave their device and money does not buy a different answer.
 * Do not "optimise" it by skipping the gate for payers — that is the version of
 * this screen that gets an app pulled.
 *
 * Deliberately the same shape as `useCreditGate` so both read identically at a
 * call site, but a SEPARATE hook. Folding a disclosure requirement into the
 * freemium gate would mean every future change to the free tier is also a change
 * to a compliance surface, and the two have no reason to move together.
 *
 * **Gate before the picker, not before the upload.** Every call site checks this
 * ahead of opening the image picker, so a user who declines is never asked to
 * choose a screenshot for a thing they just refused. It also means consent is
 * recorded strictly before the app has any of their data in hand, which is the
 * order the rule is actually about.
 *
 * One flow does NOT route through here: the Android bubble. `analyzer.tsx` is a
 * fuller disclosure than this screen — it spells out what is read, that it is
 * sent to our AI provider and discarded, requires two OS permissions and an
 * in-app switch, and is unreachable by accident — so a capture arriving from it
 * is already consented. Do not add a second prompt on
 * top of it; that path is covered, and see `docs/play-accessibility-declaration.md`.
 */
export function useAiConsent(): (engine: EngineName) => boolean {
  const granted = useRizzStore((state) => state.aiConsent);

  return useCallback(
    (engine: EngineName) => {
      if (granted) return false;
      /*
       * Logged here rather than in the screen, for the same reason
       * `credits_exhausted` is: this is the moment the gate BIT. The screen's
       * own event would only count arrivals, and the difference between the two
       * is people the router dropped.
       */
      track({ name: 'ai_consent_seen', engine });
      haptic.warning();
      router.push(`/ai-consent?engine=${engine}`);
      return true;
    },
    [granted],
  );
}
