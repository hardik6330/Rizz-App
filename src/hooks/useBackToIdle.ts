import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

/**
 * Make Android hardware back close a finished result instead of exiting the app.
 *
 * All three AI tools (Lab, Bio, Profile Scan) render their report *in place* by
 * flipping a `phase` to `'done'` rather than pushing a route. Each tab is the root
 * of its own stack, so back skipped straight past the report and left RizzCoach —
 * and users read the refresh icon as "scan another", not as "close", so a report
 * was a dead end with no in-app way out.
 *
 * Pass `active` true only while a result is on screen. Do NOT pass true during a
 * scan: the request is in flight and the credit is already charged, so swallowing
 * back would trap the user for the length of the call with nothing to show.
 *
 * No-ops on iOS, which has no hardware back — the on-screen refresh button is the
 * only affordance there, and it already works.
 *
 * `reset` must be referentially stable (wrap it in `useCallback`) or the listener
 * resubscribes on every render.
 */
export function useBackToIdle(active: boolean, reset: () => void): void {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        reset();
        return true; // consumed — do not let the navigator pop the tab
      });
      return () => sub.remove();
    }, [active, reset]),
  );
}
