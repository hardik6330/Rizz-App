import { Platform } from 'react-native';

import { FEED_ITEMS } from '@/data/feed';
import type { FeedItem } from '@/types';

/**
 * Wingman home-screen widget bridge.
 *
 * Pushes today's opener into the shared App Group so the iOS WidgetKit
 * extension (widgets/ios/RizzWidgets.swift) can render it. The native module
 * from @bittingz/expo-widgets only exists in a dev/production build with the
 * config plugin applied — in Expo Go this quietly no-ops.
 */

function getDailyOpener(): FeedItem {
  const openers = FEED_ITEMS.filter((item) => item.category === 'Opener');
  const dayIndex = Math.floor(Date.now() / 86_400_000); // days since epoch
  return openers[dayIndex % openers.length];
}

export function syncDailyOpenerToWidget(): void {
  if (Platform.OS !== 'ios') return;
  try {
    const widgets = require('@bittingz/expo-widgets') as {
      setWidgetData?: (json: string) => void;
      default?: { setWidgetData?: (json: string) => void };
    };
    const setWidgetData = widgets.setWidgetData ?? widgets.default?.setWidgetData;
    if (typeof setWidgetData !== 'function') return;

    const opener = getDailyOpener();
    setWidgetData(
      JSON.stringify({
        opener: opener.text,
        category: opener.category,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Expected in Expo Go — the widget module needs a dev build (see README).
  }
}
