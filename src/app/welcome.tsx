import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { isSupported } from '@/../modules/profile-capture';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticPressable } from '@/components/ui/HapticPressable';
import { BioPage } from '@/screens/welcome/BioPage';
import { DemoPage } from '@/screens/welcome/DemoPage';
import { LabPage } from '@/screens/welcome/LabPage';
import { ScanPage } from '@/screens/welcome/ScanPage';
import { visualHeight } from '@/screens/welcome/shared';
import { styles } from '@/screens/welcome/styles';
import { track } from '@/services/analytics';
import { useRizzStore } from '@/state/useRizzStore';
import { gutterFor } from '@/theme/layout';
import { spacing } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * First launch, step 0 of 4 — the tour, and then the demo, both before signup.
 *
 * It exists to answer the objection written into the account gate's own comment
 * in `_layout.tsx`: that screen "lands before the user has seen a single
 * result, so every install that will not hand over an email is lost here". This
 * screen is the result, shown before the ask.
 *
 * Four pages on Android, in this order and for this reason:
 *
 *   0  Bio Lab — chips picked, a vibe chosen, a bio written.
 *   1  The Lab — a screenshot uploaded, read, and replies handed back.
 *   2  Profile Scan — a profile, the ✨ bubble, the app coming forward with the
 *      report already written.                              ⚠️ ANDROID ONLY
 *   3  Chat — a conversation with no good reply, the ✨ button, the thread read
 *      end to end, the reply on the clipboard.              ⚠️ ANDROID ONLY
 *
 * **On iOS it is the first two only** — see `PAGES` below. The bubble is an
 * accessibility service; demoing it to an iPhone user advertises something the
 * app cannot do.
 *
 * The order is a widening claim: two things you do *inside* the app, then two
 * things it does *inside theirs*. That split is also why pages 0–1 swap their
 * content in place while 2–3 use sheets — see the note on `styles.report`. The
 * ✨ appears only on 2–3, so the gesture keeps meaning one specific thing. It is
 * also why iOS truncating to 0–1 is a clean cut rather than a hole: the first
 * half is a complete claim on its own.
 *
 * Each page lives in `src/screens/welcome/`, with its own script constants next
 * to the component that reads them. This file is the pager, the dots, the CTA
 * and the Reduce Motion answer the four pages share.
 *
 * **The demo is a scripted animation, not a video.** A recording would be tens
 * of megabytes of install size, would need a re-export for every copy or UI
 * change, could not be translated, and would letterbox on any aspect ratio it
 * was not exported for. This renders at the device's own resolution and stays in
 * step with the palette by construction.
 *
 * **Every mock on every page is hardcoded, and must stay hardcoded.** This
 * screen runs before the account exists, before the consent gate and before any
 * credit could be charged — a live call here would upload nothing (there is
 * nothing to upload yet) and bill a user who has agreed to nothing.
 */

/**
 * The pages, in order — and on iOS there are only two of them.
 *
 * ⚠️ `ScanPage` and `DemoPage` are the ✨ bubble: a profile scanned from inside
 * Instagram, and a chat answered from inside it. The bubble is an Android
 * accessibility service and iOS has no equivalent, so on an iPhone those two
 * pages demo a feature the binary cannot deliver — on the FIRST screen of the
 * app, before the user has an account, and in front of a store reviewer. Same
 * rule, and the same `isSupported` gate, as `FEATURES` in `paywall.tsx`.
 *
 * The docblock above calls the order "a widening claim: two things you do inside
 * the app, then two things it does inside theirs." iOS keeps the first half,
 * which stands on its own — Bio Lab and the Lab ARE the two tools an iPhone user
 * gets. What it must not do is make the second claim and then not honour it.
 *
 * Everything else here derives from this array: the dots, the CTA's label, and
 * what counts as the last page. Adding a page means adding it here and nowhere
 * else.
 */
const PAGES = isSupported
  ? [BioPage, LabPage, ScanPage, DemoPage]
  : [BioPage, LabPage];

/** Index of the final page — the one whose CTA leaves the demo. */
const LAST = PAGES.length - 1;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const gutter = gutterFor(width);
  const seeWelcome = useRizzStore((s) => s.seeWelcome);

  const visualH = visualHeight(height);

  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  /*
   * Reduce Motion is not decoration here. The last page's entire content is a
   * repeating animation, and for a user with vestibular sensitivity an
   * eight-second loop that never stops is the exact thing the setting exists to
   * turn off. So we hold the FINAL frame — the pasted reply, which is the point
   * of the whole sequence — rather than dropping them to a static empty chat.
   *
   * **Seeded synchronously, and that is the whole point.** This was
   * `useState<boolean | null>(null)` filled in by the `isReduceMotionEnabled()`
   * promise below, and `usePhaseLoop` refuses to tick until the answer is a
   * definite `false` — correctly, since starting early shows the opening frames
   * of an animation the user asked never to see. But that meant no page could
   * begin its first hold until a native round trip resolved, so the first beat
   * of every demo was late by however long that took, on top of the hold itself.
   * Reanimated's `useReducedMotion()` reads the same system value from a cached
   * native constant with no await, so the first frame already knows.
   *
   * The listener stays: `useReducedMotion` is captured at startup and does not
   * follow a change made while the app is open.
   */
  const [reduceMotion, setReduceMotion] = useState<boolean>(useReducedMotion);
  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  /**
   * Lift the splash `_layout.tsx` is holding — this screen is now the first
   * thing a cold install renders, so it inherits the job `account.tsx` used to
   * do. Same reasoning as the copy of this effect there: hiding it in the
   * layout would uncover whatever the navigator had painted at that moment.
   */
  const startedAt = useRef(0);
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
    startedAt.current = Date.now();
    track({ name: 'welcome_seen' });
  }, []);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      setPage(Math.round(e.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  const advance = useCallback(() => {
    if (page < LAST) {
      haptic.light();
      scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
      return;
    }
    track({ name: 'welcome_done', ms: Date.now() - startedAt.current });
    /*
     * No navigation. `_layout.tsx` declares this route only while the flag is
     * false, so setting it removes the screen and leaves `/account` as the only
     * route the navigator has — the same trick the account gate itself uses to
     * avoid ever painting a frame of a screen the user is not through to yet.
     */
    seeWelcome();
  }, [page, width, seeWelcome]);

  const pageProps = { width, visualH, gutter, top: insets.top, reduceMotion };

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        /* Full-bleed: a gutter on the scroller itself would offset every page
           by half of it and break the paging alignment. Pages apply their own. */
        style={styles.pager}
      >
        {/* `live` gates each loop's timer — see `usePhaseLoop`. Without it every
            page burns a timer and a re-render behind the others from the app's
            first frame. */}
        {PAGES.map((Page, i) => (
          <Page key={i} {...pageProps} live={page === i} />
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>

        <HapticPressable style={styles.cta} onPress={advance} feedback="medium">
          <Text style={styles.ctaText}>{page === LAST ? 'Get started' : 'Next'}</Text>
        </HapticPressable>

        <Text style={styles.footnote}>
          {page === LAST ? 'Takes about a minute to set up.' : 'Swipe to see the rest.'}
        </Text>
      </View>
    </View>
  );
}
