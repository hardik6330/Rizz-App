import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { isSupported, isWatching, serviceKilled } from '@/../modules/profile-capture';

/**
 * Whether the ✨ bubble is running, refreshed every time the screen is focused.
 *
 * Two screens need this and both used to derive it themselves. Focus is the only
 * signal available: the accessibility service is granted in the OS Settings app
 * and killed by the OS, so nothing in JS gets an event — the analyzer screen is
 * a modal over the tabs, and returning from Settings is a resume. Pull on focus
 * or do not find out at all.
 *
 * `killed` is the third state and the reason this is not a boolean. Granted in
 * Settings but not bound means the OS ended our process and never restarted the
 * service — what MIUI, ColorOS and FuntouchOS do on swipe-away. "Turn it on"
 * copy is actively wrong there: the switch is already on, and nothing inside the
 * app can fix it.
 */
export function useBubbleState(): { supported: boolean; watching: boolean; killed: boolean } {
  const [watching, setWatching] = useState(false);
  const [killed, setKilled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isSupported) return;
      setWatching(isWatching());
      setKilled(serviceKilled());
    }, []),
  );

  return { supported: isSupported, watching, killed };
}
