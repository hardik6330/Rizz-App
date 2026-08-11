import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeInUp,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  ZoomIn,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticPressable } from '@/components/HapticPressable';
import { AVATARS, BG } from '@/data/assets';
import { INTERESTS } from '@/data/interests';
import { ANALYZE_STAGES } from '@/data/mockAnalysis';
import { track } from '@/services/analytics';
import { PROFILE_STAGES } from '@/services/profileEngine';
import { useRizzStore } from '@/state/useRizzStore';
import { gutterFor } from '@/theme/layout';
import type { BioVibe, ReplyStyle } from '@/types';
import { absoluteFill, glow, palette, radii, spacing, type } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * First launch, step 0 of 4 — the tour, and then the demo, both before signup.
 *
 * It exists to answer the objection written into the account gate's own comment
 * in `_layout.tsx`: that screen "lands before the user has seen a single
 * result, so every install that will not hand over an email is lost here". This
 * screen is the result, shown before the ask.
 *
 * Four pages, all four demoed, in this order and for this reason:
 *
 *   0  Bio Lab — chips picked, a vibe chosen, a bio written.
 *   1  The Lab — a screenshot uploaded, read, and replies handed back.
 *   2  Profile Scan — a profile, the ✨ bubble, the app coming forward with the
 *      report already written.
 *   3  Chat — a conversation with no good reply, the ✨ button, the thread read
 *      end to end, the reply on the clipboard.
 *
 * The order is a widening claim: two things you do *inside* the app, then two
 * things it does *inside theirs*. That split is also why pages 0–1 swap their
 * content in place while 2–3 use sheets — see the note on `styles.report`. The
 * ✨ appears only on 2–3, so the gesture keeps meaning one specific thing.
 *
 * There are no stills left. Every page moves, which is a decision with a real
 * cost: four loops means nothing is the singular payoff any more, so the pages
 * carry that weight through the sheet language above instead of through motion
 * versus stillness.
 *
 * Then `/account`, then the three setup questions, then the analyzer permission
 * walkthrough. See the first-run table in docs/README.md.
 *
 * **The demo is a scripted animation, not a video.** A recording would be tens
 * of megabytes of install size, would need a re-export for every copy or UI
 * change (and so would silently drift out of date the first time nobody
 * bothered), could not be translated, and would letterbox on any aspect ratio
 * it was not exported for. This renders at the device's own resolution and
 * stays in step with the palette by construction.
 *
 * **Every mock on every page is hardcoded, and must stay hardcoded.** This
 * screen runs before the account exists, before the consent gate and before any
 * credit could be charged — a live call here would upload nothing (there is
 * nothing to upload yet) and bill a user who has agreed to nothing.
 */

/* ── The chat demo script ──────────────────────────────────────────────────
 *
 * Phase durations are the pacing, and the sum is what `welcome_done { ms }`
 * gets compared against — keep them in step with the note on that event in
 * `analytics.ts`.
 */
const PHASES = ['chat', 'tap', 'think', 'type', 'done'] as const;
type Phase = (typeof PHASES)[number];

const HOLD: Record<Phase, number> = {
  chat: 2400,
  tap: 900,
  /*
   * This phase does three things in sequence — scroll back, sweep, scroll
   * forward again — so it is the long one. The real service spends
   * `CHAT_SCROLLS × SCROLL_SETTLE_MS` = 3 × 450ms scrolling alone before it has
   * even sent the request, so this is not padding; a shorter version would
   * misrepresent how long the pause on a real chat actually is.
   */
  think: 2600,
  type: 2000,
  done: 2400,
};

/**
 * What the body copy says during each phase.
 *
 * ⚠️ `done` says **copied**, not pasted or sent, and that is not a wording
 * preference. `RizzAccessibilityService.copyToClipboard(result.reply)` is what
 * actually happens; the service's own toast is "✨ Reply copied — paste &
 * send". It never types into the host app and never sends. A first-run demo
 * showing the reply land in her chat window would be promising an action the
 * app does not perform — and the accessibility declaration turns on the app
 * NOT acting autonomously, so over-claiming here contradicts the Play
 * submission as well as the user's experience.
 */
const CAPTION: Record<Phase, string> = {
  chat: 'A conversation going somewhere. And nothing to say back.',
  tap: 'Tap ✨ — it scrolls back through the chat.',
  think: 'Reading the whole thread, not just the last line.',
  type: 'A reply in her tone, answering what she actually said.',
  done: 'Copied. Paste it and send.',
};

/**
 * The demo conversation.
 *
 * Deliberately a real back-and-forth with history rather than one orphan
 * message, because the thing being demonstrated is **context**: a tool that
 * only read the last line could not know about the third photo or the running
 * joke, and the reply would be indistinguishable from a generic opener. The
 * thread is taller than its box on purpose — the top clips behind a fade, which
 * is what makes it read as a conversation already in progress.
 *
 * Flirty but not explicit, and nothing here is a real person or a real chat.
 * This copy ships in the store listing screenshots, so it is held to that bar.
 */
interface Line {
  from: 'them' | 'me';
  text: string;
}

const THREAD: Line[] = [
  { from: 'them', text: 'ok the guy in photo 4 is either your brother or a red flag 😭' },
  { from: 'me', text: 'brother. tragically.' },
  { from: 'them', text: 'phew ok we can continue' },
  { from: 'them', text: 'you picked that third photo on purpose btw 👀' },
  { from: 'me', text: 'I plead the fifth' },
  { from: 'them', text: 'the fifth is for guilty people 😌' },
  { from: 'me', text: 'and for people with a very good third photo' },
  { from: 'them', text: 'fine, you win this round 🤝' },
  { from: 'them', text: 'my dog is called Rigatoni. named him while hungry. your move 🍝' },
];

/*
 * The reply picks up her 😭 on purpose, and that is a demonstration rather than
 * decoration: `prompts.ts` tells the model to "mirror the user's own voice from
 * the screenshot: their capitalisation, punctuation habits, **emoji use or
 * total lack of it**, slang, and typical message length". A reply that came
 * back clean and formal into a thread full of 😭 and 👀 is exactly what makes a
 * generated line read as generated, so the demo should not show one.
 *
 * One emoji, not three — the same file says "no emoji spam".
 */
const REPLY =
  'Rigatoni is elite naming and a worrying insight into your grocery habits 😭 what was the runner-up, Linguine?';

/**
 * How far the thread scrolls back during the read, in points.
 *
 * The real service scrolls the conversation up **three times**, reading between
 * each step, then scrolls back to where the user was — `CHAT_SCROLLS = 3` in
 * `RizzAccessibilityService`, and `analyzer.tsx` warns the user they will see
 * their screen move. So the demo scrolls too: it is the most surprising thing
 * the app does, and someone who meets it for the first time on a real chat
 * without warning reads it as the phone being possessed.
 *
 * Roughly three messages' worth. The thread holds far more hidden history than
 * this, so it cannot scroll past the top.
 */
const REVEAL = 170;

/* ── The profile-scan demo script ──────────────────────────────────────────
 *
 * Same five-beat shape as the chat demo, and deliberately so: two pages running
 * two different rhythms would read as two different products.
 */
const SCAN_PHASES = ['card', 'tap', 'open', 'report', 'done'] as const;
type ScanPhase = (typeof SCAN_PHASES)[number];

const SCAN_HOLD: Record<ScanPhase, number> = {
  card: 2400,
  tap: 900,
  /* Long enough to show all four of `PROFILE_STAGES.them` — see `Stages`. */
  open: 2600,
  report: 2200,
  done: 2400,
};

/**
 * ⚠️ Every one of these is checked against what the app actually does.
 *
 * `open` says the app comes forward, because it does: a bubble tap on a profile
 * runs `onAnalyzeTapped` → screenshot → `CaptureStore` push → **`launchApp()`**
 * (`RizzAccessibilityService.kt`). The report is rendered by RizzCoach, not
 * drawn over the dating app, which is why the sheet on this page covers the
 * whole card instead of sliding up inside it.
 *
 * `done` says *tap to copy*, not "copied". `PROFILE_LABELS.them.linesHint` is
 * "Tap copy to send one…" — the openers sit there until the user takes one. The
 * chat bubble auto-copies; this does not, and the two must not be conflated.
 *
 * Nothing here promises a match. `PROFILE_LABELS.them.disclaimer` is explicit
 * that a scan is "conversation prep — they're a whole human, not a score", and
 * a first-run screen that promised otherwise would be contradicted by the first
 * report the user ever opens.
 */
const SCAN_CAPTION: Record<ScanPhase, string> = {
  card: 'Good photos. A bio you have read four times. Still nothing to send.',
  tap: 'Tap ✨ — no screenshots, no cropping, no switching apps.',
  open: 'RizzCoach opens with her profile already read.',
  report: 'Scored and explained — then openers built off what is actually there.',
  done: 'Tap a line to copy it. Then go say something worth answering.',
};

/**
 * The mock report.
 *
 * The SHAPE is `ProfileScanResult` in 'them' mode and the labels are lifted
 * from `PROFILE_LABELS.them` verbatim — `scoreA` is "First Impression",
 * `scoreB` is "Shared-Interest Signal", `quickWin` is "Your best opening move".
 * The numbers and prose are invented, but if those labels are ever renamed this
 * page is renaming with them or it is showing a screen the app does not have.
 *
 * Two scores, not five: `ProfileScore` slots come in a pair.
 */
const SCAN_SCORES = [
  { label: 'First Impression', score: '8.4', note: 'Photo 1 is doing real work.' },
  { label: 'Shared-Interest Signal', score: '7.1', note: 'Climbing, ceramics, one dog.' },
] as const;

/*
 * Kept to two lines at the demo card's width. The card clips (`overflow:
 * hidden` on `phone`) and the opener is the payoff of the whole page, so a
 * longer line does not wrap — it disappears on a small phone.
 */
const SCAN_OPENER = 'The pottery in photo 3 — yours, or are you just standing near it? 👀';

/** The invented profile. See the note on `styles.profile` about trade dress. */
const SCAN_PROFILE = {
  name: 'Maya, 26',
  tagline: 'Bristol · 4 km away',
  chips: ['Ceramics', 'Bouldering', 'Dog person'],
  bio: 'I will beat you at mini golf and be insufferable about it.',
};

/* ── The Bio Lab demo script ───────────────────────────────────────────────
 *
 * The beats are `BioInput` being filled in: `interests`, then `vibe`, then the
 * `BioResult` that comes back. Nothing invented about the flow — that is the
 * screen, in that order.
 */
const BIO_PHASES = ['blank', 'pick', 'vibe', 'write', 'bio'] as const;
type BioPhase = (typeof BIO_PHASES)[number];

const BIO_HOLD: Record<BioPhase, number> = {
  /* Short: nothing moves during it, and its only job is letting the eye land on
     the chip grid before something starts happening to it. */
  blank: 800,
  /* Three chips light one after another — see `BIO_PICKS`. */
  pick: 1800,
  vibe: 900,
  write: 1600,
  bio: 2600,
};

const BIO_CAPTION: Record<BioPhase, string> = {
  blank: 'The blank bio box. Everyone loses ten minutes here.',
  pick: 'Tap what is actually true about you.',
  vibe: 'Pick the vibe you want to come across as.',
  write: 'It writes from what you picked, not from a template.',
  bio: 'Three versions back. Take one, or take the best line from each.',
};

/**
 * Three worked examples, one per time round the loop.
 *
 * ⚠️ **Every bio must be traceable back to its own three chips.** That is the
 * entire claim the page makes — a bio you cannot trace back to what you tapped
 * is a template, and showing one would demonstrate the opposite of the feature.
 * Change a pick and change the bio with it.
 *
 * Picks are named by LABEL, not index, so reordering `INTERESTS` cannot
 * silently change which chips light up. Three picks because that is roughly
 * what a real user taps.
 *
 * The three `label`s cover all three of `BioTone` — Playful, Sincere,
 * Mysterious — so watching the loop twice shows the range rather than the same
 * voice with different nouns. `BioResult.bios` really does return three
 * variants, which is what the "1 of 3" marker reports.
 *
 * Three examples rather than one because the second watch has to pay: a loop
 * that replays identically is the moment a user decides they have seen it.
 */
interface BioVariant {
  /**
   * Exactly three, enforced as a tuple rather than an array. `BIO_HOLD.pick` is
   * paced against `BIO_PICK_COUNT`, so a fourth chip would silently outrun the
   * beat and never be seen lit — this makes that a compile error instead of
   * something someone notices on a device.
   */
  picks: readonly [string, string, string];
  vibe: BioVibe;
  /** `BioOption.label` — the human-facing style string. */
  label: string;
  text: string;
}

const BIO_VARIANTS: BioVariant[] = [
  {
    picks: ['Pet Lover', 'Foodie', 'Adventurer'],
    vibe: 'Funny' as BioVibe,
    label: 'Playful & Witty',
    text: 'Will drive two hours for a mountain and four for a good breakfast. My dog has met more of my friends than my family has.',
  },
  {
    picks: ['Bookworm', 'Coffee Lover', 'Music Head'],
    vibe: 'Chill' as BioVibe,
    label: 'Warm & Sincere',
    text: 'Sundays are a book, a flat white and whatever the algorithm has decided I am sad about. Come recommend me something better.',
  },
  {
    picks: ['Gym Rat', 'Tech Geek', 'Coffee Lover'],
    vibe: 'Sarcastic' as BioVibe,
    label: 'Dry & Mysterious',
    text: 'I lift heavy things and then explain why the app you like is badly built. I get interesting somewhere around the third coffee.',
  },
];

/** Picks per variant — see `BioVariant.picks`, which enforces it. */
const BIO_PICK_COUNT = 3;

/* ── The Lab demo script ───────────────────────────────────────────────────
 *
 * The home tab: a screenshot in, `ANALYZE_STAGES`, replies out. This page
 * replaced a Vault still — the Lab is where a new user actually lands, and a
 * place you go to later does not earn a page in front of the signup gate.
 */
const LAB_PHASES = ['empty', 'upload', 'shot', 'read', 'reply'] as const;
type LabPhase = (typeof LAB_PHASES)[number];

const LAB_HOLD: Record<LabPhase, number> = {
  empty: 800,
  upload: 900,
  shot: 1100,
  /** Long enough to show all four of `ANALYZE_STAGES`. */
  read: 2600,
  reply: 2800,
};

/**
 * ⚠️ `empty` says *pick a screenshot*, not "take one" — the app opens the photo
 * library (`ImagePicker`), it has no camera path and no screen recording.
 */
const LAB_CAPTION: Record<LabPhase, string> = {
  empty: 'No screen permissions, no setup. Just a screenshot you already have.',
  upload: 'Pick the conversation from your camera roll.',
  shot: 'That is the whole input.',
  read: 'It reads the thread, not just the last message.',
  reply: 'Three replies, three different levels of nerve. Copy or save any of them.',
};

/**
 * Two screenshots, one per time round the loop, each with its own replies.
 *
 * Two rather than three because this page's beats are longer than Bio Lab's —
 * a third would put the variety three loops deep, which is past the point
 * anyone is still watching.
 *
 * Shape is `ReplyOption`: `style` is `ReplyStyle`, a closed union of exactly
 * these three, and `spice` is the 1–3 scale (1 = safe, 3 = spicy). **All three
 * styles appear in both variants, always in the same order.** The choice
 * between them is the feature — a variant that showed two would read as the
 * model having found only two answers.
 *
 * ⚠️ The replies must answer the LAST line of their own thread specifically.
 * A reply that would work under either screenshot demonstrates a template,
 * which is the thing the whole page exists to argue against.
 *
 * This copy ships in store-listing screenshots: flirty, clean, obviously
 * fictional, no real handles.
 */
interface LabVariant {
  thread: readonly Line[];
  /**
   * Exactly three, and a tuple so it stays that way. `ReplyStyle` is a closed
   * union of Smooth / Playful / Bold and the app always returns all three; a
   * variant showing two would read as the model having found only two answers.
   */
  replies: readonly [ReplyOption, ReplyOption, ReplyOption];
}

/** The demo's own slice of `ReplyOption` — `id` belongs to a real result. */
interface ReplyOption {
  style: ReplyStyle;
  /** 1 = safe, 3 = spicy. */
  spice: 1 | 2 | 3;
  text: string;
}

const LAB_VARIANTS: LabVariant[] = [
  {
    thread: [
      { from: 'them', text: 'so what is your whole deal 😅' },
      { from: 'me', text: 'depends, is this a job interview' },
      { from: 'them', text: 'yes. and you are doing badly' },
    ],
    replies: [
      { style: 'Smooth', spice: 1, text: 'Rough first round. Let me buy you a coffee and appeal the decision.' },
      { style: 'Playful', spice: 2, text: 'I peak in round two. Ask me a real question 😌' },
      { style: 'Bold', spice: 3, text: 'Then hire me for Thursday and judge me in person.' },
    ],
  },
  {
    thread: [
      { from: 'them', text: 'ok you seem normal which is suspicious 🤨' },
      { from: 'me', text: 'that is exactly what a normal person would say' },
      { from: 'them', text: 'ugh. fine. what is your red flag' },
    ],
    replies: [
      { style: 'Smooth', spice: 1, text: 'I reply fast. Apparently that unsettles people.' },
      { style: 'Playful', spice: 2, text: 'I will rank every restaurant we go to. Out of ten. In writing 📝' },
      { style: 'Bold', spice: 3, text: 'I skip the small talk and just ask. Drinks Thursday?' },
    ],
  },
];

/** Each page's `facts` — same rule as everywhere: a claim we have to honour. */
const BIO_FACTS = ['Three versions', 'Rewrites yours', 'Or starts fresh'];
const LAB_FACTS = ['From a screenshot', 'Three styles', 'Save what lands'];
const SCAN_FACTS = ['Theirs or your own', 'Scored out of 10', 'Openers that fit'];
const DEMO_FACTS = ['Works in your chat app', 'Matches your style', 'Nothing saved'];

/** Page indices. The chat demo is always last. */
const BIO = 0;
const LAB = 1;
const SCAN = 2;
const DEMO = 3;
const PAGES = 4;

/**
 * How tall the visual at the top of every page is.
 *
 * **One number for all four pages, and that is the point.** The tour pages and
 * the demo page used to disagree about their own layout — the tour put its
 * image on top with the copy beneath, and the demo put its title on top with
 * the chat beneath and a dead black band under that. Swiping between them read
 * as two different screens stitched together. Everything now uses `Page`:
 * visual, kicker, title, body, facts, in that order, at this height.
 *
 * Proportional so it fills a tall screen instead of stranding black space, and
 * clamped so it neither crushes the copy on a small phone nor turns into a
 * poster on a tablet.
 */
function visualHeight(windowHeight: number): number {
  /*
   * The ratio and both clamps are budgeted against the copy block, not chosen
   * by eye. Below the visual sits ~222pt of kicker, two lines of hero title,
   * two lines of body and a row of facts, and below THAT the footer's dots, CTA
   * and footnote take ~140pt plus the bottom inset. On a 667pt phone that
   * leaves ~270 for the visual, which is what the lower clamp protects. Raise
   * the ratio or the floor and the facts row slides under the CTA on small
   * phones — where nothing scrolls vertically, so it is simply lost.
   */
  return Math.round(Math.min(340, Math.max(230, windowHeight * 0.4)));
}

/** Chrome inside the chat card that is not the thread: bar, composer, gaps. */
const CARD_CHROME = 114;

/**
 * The clock both demo pages run on.
 *
 * One hook rather than a copy of the timer per page, because the two loops have
 * to agree about the two things that are easy to get subtly wrong: they only
 * tick on the page the user is actually looking at (otherwise every demo burns
 * a timer and a re-render behind the others from the app's first frame), and
 * they do not start at all until Reduce Motion has answered — `null` means we
 * have not asked yet, and starting early shows the opening frames of an
 * animation the user has asked never to see.
 *
 * Returns the phase to RENDER, which is the held final frame under Reduce
 * Motion. Derived rather than stored, so there is no second piece of state for
 * the effect to keep in sync.
 */
function usePhaseLoop<P extends string>(
  phases: readonly P[],
  hold: Record<P, number>,
  live: boolean,
  reduceMotion: boolean | null,
): { phase: P; cycle: number } {
  const [loopPhase, setLoopPhase] = useState<P>(phases[0]);
  /**
   * How many times the loop has come all the way round.
   *
   * Pages with more than one example script index into it, so the second watch
   * shows different content instead of the same script again — a loop that
   * replays identically tells the user they have already seen it, which is the
   * moment they reach for Next.
   */
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (reduceMotion !== false || !live) return;
    const i = phases.indexOf(loopPhase);
    const wrapping = i === phases.length - 1;
    const t = setTimeout(() => {
      setLoopPhase(phases[(i + 1) % phases.length]);
      // Bumped on the wrap, not on mount, so the FIRST pass is always variant 0
      // — otherwise which example a user sees first depends on timing.
      if (wrapping) setCycle((c) => c + 1);
    }, hold[loopPhase]);
    return () => clearTimeout(t);
  }, [loopPhase, reduceMotion, live, phases, hold]);

  /*
   * The last phase, not the first. Every demo ends on its payoff — the copied
   * reply, the finished report, the written bio — so a user who has turned
   * animation off gets the answer rather than an empty chat or a blank form.
   */
  return { phase: reduceMotion ? phases[phases.length - 1] : loopPhase, cycle };
}

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
   * `null` while unknown so the first frame is not the wrong one.
   */
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setReduceMotion(on));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
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
    if (page < DEMO) {
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
        {/* `live` gates each loop's timer — see `usePhaseLoop`. */}
        <BioPage
          width={width}
          visualH={visualH}
          gutter={gutter}
          top={insets.top}
          live={page === BIO}
          reduceMotion={reduceMotion}
        />
        <LabPage
          width={width}
          visualH={visualH}
          gutter={gutter}
          top={insets.top}
          live={page === LAB}
          reduceMotion={reduceMotion}
        />
        <ScanPage
          width={width}
          visualH={visualH}
          gutter={gutter}
          top={insets.top}
          live={page === SCAN}
          reduceMotion={reduceMotion}
        />
        <DemoPage
          width={width}
          visualH={visualH}
          gutter={gutter}
          top={insets.top}
          live={page === DEMO}
          reduceMotion={reduceMotion}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {Array.from({ length: PAGES }, (_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>

        <HapticPressable style={styles.cta} onPress={advance} feedback="medium">
          <Text style={styles.ctaText}>{page === DEMO ? 'Get started' : 'Next'}</Text>
        </HapticPressable>

        <Text style={styles.footnote}>
          {page === DEMO ? 'Takes about a minute to set up.' : 'Swipe to see the rest.'}
        </Text>
      </View>
    </View>
  );
}

/* ── Pages ─────────────────────────────────────────────────────────────────── */

/**
 * The shape every page shares: visual on top, then kicker, title, body, facts.
 *
 * Its whole job is that no page gets to invent its own arrangement. `children`
 * is the visual and is given a fixed height by the caller, so the copy block
 * below starts at the same y on all four pages and swiping does not shuffle the
 * layout under the reader.
 */
function Page({
  width,
  gutter,
  top,
  kicker,
  title,
  body,
  facts,
  children,
}: {
  width: number;
  gutter: number;
  top: number;
  kicker: string;
  title: string;
  body: React.ReactNode;
  facts: string[];
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.page, { width, paddingHorizontal: gutter, paddingTop: top + spacing.lg }]}>
      {children}

      <Animated.View entering={FadeInDown.duration(420)} style={styles.copy}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.title}>{title}</Text>
        {/* A node, not a string: the demo page passes an animated caption that
            cross-fades between phases, and everything else passes plain text. */}
        {typeof body === 'string' ? <Text style={styles.body}>{body}</Text> : body}

        <View style={styles.facts}>
          {facts.map((fact) => (
            <View key={fact} style={styles.fact}>
              <Ionicons name="checkmark" size={12} color={palette.mint} />
              <Text style={styles.factText}>{fact}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Absorbs whatever is left over so the copy sits under the visual rather
          than being spread down the page by `justifyContent`. */}
      <View style={styles.spacer} />
    </View>
  );
}

/**
 * The four vibes, mirroring `VIBES` in `(tabs)/bio.tsx`.
 *
 * Typed `BioVibe[]` rather than plain strings so a rename in the union breaks
 * this at compile time. The list is four short literals — small enough to keep
 * here, unlike `INTERESTS`, which is imported for exactly the drift reason its
 * own file explains.
 */
const VIBES: BioVibe[] = ['Funny', 'Sarcastic', 'Chill', 'Ambitious'];

/**
 * Demo 1 of 4 — Bio Lab.
 *
 * The content swaps IN PLACE at the end rather than under a sheet, because that
 * is what the real screen does: `bio.tsx` runs one phase machine and replaces
 * its own form with the result. The sheet language on pages 2–3 means something
 * specific (see `styles.report`), so it is not reached for here.
 */
function BioPage({
  width,
  visualH,
  gutter,
  top,
  live,
  reduceMotion,
}: {
  width: number;
  visualH: number;
  gutter: number;
  top: number;
  live: boolean;
  reduceMotion: boolean | null;
}) {
  const { phase, cycle } = usePhaseLoop(BIO_PHASES, BIO_HOLD, live, reduceMotion);
  const v = BIO_VARIANTS[cycle % BIO_VARIANTS.length];

  return (
    <Page
      width={width}
      gutter={gutter}
      top={top}
      kicker="Bio Lab"
      title={'A bio that sounds\nlike you, only sharper.'}
      facts={BIO_FACTS}
      body={
        <View style={styles.captionBox}>
          <Animated.Text key={phase} entering={FadeIn.duration(260)} style={styles.body}>
            {BIO_CAPTION[phase]}
          </Animated.Text>
        </View>
      }
    >
      <View style={[styles.phone, { height: visualH }]}>
        {phase === 'bio' ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.bioResult}>
            <View style={styles.openerBar}>
              <View style={styles.toneChip}>
                <Text style={styles.toneChipText}>{v.label}</Text>
              </View>
              {/* `BioResult.bios` really does come back as three. */}
              <Text style={styles.reportMode}>1 of 3</Text>
            </View>
            <Text style={styles.bioText}>{v.text}</Text>
            <View style={styles.bioActions}>
              <View style={styles.ghostButton}>
                <Ionicons name="copy-outline" size={13} color={palette.textSecondary} />
                <Text style={styles.ghostButtonText}>Copy</Text>
              </View>
              <View style={styles.ghostButton}>
                <Ionicons name="bookmark-outline" size={13} color={palette.gold} />
                <Text style={styles.ghostButtonText}>Save</Text>
              </View>
            </View>
          </Animated.View>
        ) : (
          <View style={styles.bioForm}>
            <Text style={styles.sectionLabel}>YOUR INTERESTS</Text>
            {/* Keyed on the phase so the ticker inside restarts each beat —
                same remount-instead-of-reset trick as `ReplyText`. */}
            <BioChips key={phase} phase={phase} picks={v.picks} />

            <Text style={styles.sectionLabel}>YOUR VIBE</Text>
            <View style={styles.chips}>
              {VIBES.map((vibe) => {
                const on = vibe === v.vibe && (phase === 'vibe' || phase === 'write');
                return (
                  <View key={vibe} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{vibe}</Text>
                  </View>
                );
              })}
            </View>

            {phase === 'write' && (
              <Animated.View entering={FadeIn.duration(240)} style={styles.writing}>
                <Text style={styles.stageText}>Writing three versions…</Text>
              </Animated.View>
            )}
          </View>
        )}
      </View>
    </Page>
  );
}

/**
 * The interest grid, with the picks lighting one after another during `pick`.
 *
 * The count is DERIVED from the phase rather than stored — `blank` is none,
 * `pick` is however many the ticker has reached, and everything after is all of
 * them. Storing it would need an effect writing state back on every phase
 * change, which is the lint rule this file has already been bitten by twice.
 */
function BioChips({ phase, picks }: { phase: BioPhase; picks: readonly string[] }) {
  // Divided by picks + 1, not picks, so the last chip lands before the beat
  // ends rather than exactly on the boundary where it would never be seen lit.
  const tick = useTicker(BIO_HOLD.pick / (BIO_PICK_COUNT + 1));
  const count =
    phase === 'blank' ? 0 : phase === 'pick' ? Math.min(tick, picks.length) : picks.length;
  const picked = picks.slice(0, count);

  return (
    <View style={styles.chips}>
      {INTERESTS.map((item) => {
        const on = picked.includes(item.label);
        return (
          <View key={item.label} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              {item.emoji} {item.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Demo 2 of 4 — the Lab, which is the tab a new user actually lands on.
 *
 * It replaced a Vault still. The Vault is somewhere you go once you already
 * have lines worth keeping, and a screen shown before signup has to earn its
 * page against the thing the user will open first.
 */
function LabPage({
  width,
  visualH,
  gutter,
  top,
  live,
  reduceMotion,
}: {
  width: number;
  visualH: number;
  gutter: number;
  top: number;
  live: boolean;
  reduceMotion: boolean | null;
}) {
  const { phase, cycle } = usePhaseLoop(LAB_PHASES, LAB_HOLD, live, reduceMotion);
  const v = LAB_VARIANTS[cycle % LAB_VARIANTS.length];
  const at = (p: LabPhase): boolean => LAB_PHASES.indexOf(phase) >= LAB_PHASES.indexOf(p);

  return (
    <Page
      width={width}
      gutter={gutter}
      top={top}
      kicker="The Lab"
      title={'Paste in a chat.\nGet three ways out.'}
      facts={LAB_FACTS}
      body={
        <View style={styles.captionBox}>
          <Animated.Text key={phase} entering={FadeIn.duration(260)} style={styles.body}>
            {LAB_CAPTION[phase]}
          </Animated.Text>
        </View>
      }
    >
      <View style={[styles.phone, { height: visualH }]}>
        {phase === 'reply' ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.replies}>
            {v.replies.map((r) => (
              <View key={r.style} style={styles.reply}>
                <View style={styles.openerBar}>
                  <Text style={styles.cardLabel}>{r.style}</Text>
                  <View style={styles.spice}>
                    {/* `spice` is a 1–3 scale: 1 safe, 3 spicy. Three pips
                        always drawn, filled to the level — a variable count
                        would read as three different components. */}
                    {[1, 2, 3].map((n) => (
                      <View key={n} style={[styles.pip, n <= r.spice && styles.pipOn]} />
                    ))}
                  </View>
                </View>
                <Text style={styles.replyText} numberOfLines={2}>
                  {r.text}
                </Text>
              </View>
            ))}
          </Animated.View>
        ) : (
          <View style={styles.drop}>
            {/*
              The drop pad, and it holds a real-looking screenshot rather than a
              file icon: the input is a picture of a conversation, and showing a
              generic attachment glyph would leave the user guessing what to
              give it. Miniature bubbles, because that is what a screenshot of a
              chat looks like.
            */}
            <View style={[styles.dropZone, at('shot') && styles.dropZoneFilled]}>
              {at('shot') ? (
                <Animated.View entering={ZoomIn.duration(320)} style={styles.shot}>
                  {v.thread.map((line) => (
                    <View
                      key={line.text}
                      style={[
                        styles.miniBubble,
                        line.from === 'me' ? styles.miniMine : styles.miniTheirs,
                      ]}
                    >
                      <Text style={styles.miniText} numberOfLines={1}>
                        {line.text}
                      </Text>
                    </View>
                  ))}
                </Animated.View>
              ) : (
                <View style={styles.dropEmpty}>
                  <Ionicons name="image-outline" size={22} color={palette.textTertiary} />
                  <Text style={styles.dropHint}>Your screenshot lands here</Text>
                </View>
              )}

              {phase === 'read' && <Stages lines={ANALYZE_STAGES} ms={LAB_HOLD.read / ANALYZE_STAGES.length} />}
            </View>

            {/* Always rendered, dimmed once a shot is in. Removing it at
                `shot` would hand its 40pt back to the drop zone and jump the
                layout on the exact frame the screenshot is landing. */}
            <View
              style={[
                styles.uploadButton,
                phase === 'upload' && styles.uploadButtonDown,
                at('shot') && styles.uploadButtonSpent,
              ]}
            >
              <Ionicons name="cloud-upload-outline" size={15} color={palette.textPrimary} />
              {/* "Pick", not "Take": the app opens the photo library. It has
                  no camera path and does not record the screen. */}
              <Text style={styles.uploadText}>Pick a screenshot</Text>
              {phase === 'upload' && (
                <Animated.View pointerEvents="none" entering={ZoomIn.duration(600)} style={styles.uploadRipple} />
              )}
            </View>
          </View>
        )}
      </View>
    </Page>
  );
}

/**
 * A counter that increments every `ms`, for the sub-beats inside a phase.
 *
 * Deliberately not a shared value: everything driven off it is text or a
 * discrete swap, which has to cross to the JS thread anyway.
 */
function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

/**
 * Demo 1 of 2 — the bubble on a dating profile.
 *
 * The one structural thing to keep: the RizzCoach sheet **covers the whole
 * card**, it does not slide up inside it. That is not a styling choice. A
 * bubble tap on a profile screenshots it, pushes the capture and then calls
 * `launchApp()` — RizzCoach comes to the foreground and renders the report
 * itself. A panel drawn over the dating app would depict the service painting
 * UI into another app and reading it back, which is both wrong and the exact
 * capability the Play accessibility declaration says it does not have.
 */
function ScanPage({
  width,
  visualH,
  gutter,
  top,
  live,
  reduceMotion,
}: {
  width: number;
  visualH: number;
  gutter: number;
  top: number;
  live: boolean;
  reduceMotion: boolean | null;
}) {
  const { phase } = usePhaseLoop(SCAN_PHASES, SCAN_HOLD, live, reduceMotion);
  const at = (p: ScanPhase): boolean => SCAN_PHASES.indexOf(phase) >= SCAN_PHASES.indexOf(p);

  return (
    <Page
      width={width}
      gutter={gutter}
      top={top}
      kicker="Profile Scan"
      title={'Know exactly what\nto open with.'}
      facts={SCAN_FACTS}
      body={
        <View style={styles.captionBox}>
          <Animated.Text key={phase} entering={FadeIn.duration(260)} style={styles.body}>
            {SCAN_CAPTION[phase]}
          </Animated.Text>
        </View>
      }
    >
      <View style={[styles.phone, styles.profile, { height: visualH }]}>
        {/*
          An invented profile on our own bundled art — NOT a screenshot of a
          real dating app. Recreating another company's card would put their
          trade dress in our onboarding and in our store listing, and the point
          lands without it: everyone recognises a photo, a name and an age.
        */}
        <Image source={BG.violet} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        <View style={styles.profileScrim} />

        <View style={styles.profileCopy}>
          <Text style={styles.profileName}>{SCAN_PROFILE.name}</Text>
          <Text style={styles.profileTag}>{SCAN_PROFILE.tagline}</Text>
          <View style={styles.chips}>
            {SCAN_PROFILE.chips.map((chip) => (
              <View key={chip} style={styles.chip}>
                <Text style={styles.chipText}>{chip}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.profileBio} numberOfLines={2}>
            {SCAN_PROFILE.bio}
          </Text>
        </View>

        {/* The same ✨ affordance, in the same corner, as the chat demo — it is
            one bubble in the real app and two positions would imply two. */}
        {at('tap') && !at('open') && (
          <Animated.View entering={ZoomIn.duration(300)} style={styles.sparkle}>
            <Text style={styles.sparkleGlyph}>✨</Text>
          </Animated.View>
        )}
        {phase === 'tap' && (
          <Animated.View pointerEvents="none" entering={ZoomIn.duration(700)} style={styles.ripple} />
        )}

        {/* The app switch. Full-cover, entering upward — see the note above. */}
        {at('open') && (
          <Animated.View entering={FadeInUp.duration(320)} style={styles.report}>
            <View style={styles.resultBar}>
              <Text style={styles.sparkleGlyph}>✨</Text>
              <Text style={styles.resultTitle}>RizzCoach</Text>
              <Text style={styles.reportMode}>Read their profile</Text>
            </View>

            {!at('report') ? (
              <Stages lines={PROFILE_STAGES.them} ms={SCAN_HOLD.open / PROFILE_STAGES.them.length} />
            ) : (
              <Animated.View entering={FadeIn.duration(280)} style={styles.reportBody}>
                {SCAN_SCORES.map((s) => (
                  <View key={s.label} style={styles.scoreLine}>
                    <View style={styles.scoreRow}>
                      <Text style={[styles.score, styles.reportScore]}>{s.score}</Text>
                      <Text style={styles.scoreOf}>/ 10</Text>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{s.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.scoreNote}>{s.note}</Text>
                  </View>
                ))}

                <View style={styles.opener}>
                  <View style={styles.openerBar}>
                    <Text style={styles.cardLabel}>Your best opening move</Text>
                    {at('done') && (
                      <Animated.View entering={FadeIn.duration(240)} style={styles.copied}>
                        <Ionicons name="copy-outline" size={11} color={palette.mint} />
                        <Text style={styles.copiedText}>Tap to copy</Text>
                      </Animated.View>
                    )}
                  </View>
                  <Text style={styles.resultText}>{SCAN_OPENER}</Text>
                </View>
              </Animated.View>
            )}
          </Animated.View>
        )}
      </View>
    </Page>
  );
}

/**
 * The cycling loading lines, shared by the Lab and Profile Scan demos.
 *
 * `lines` is always the app's OWN stage list — `ANALYZE_STAGES` or
 * `PROFILE_STAGES.them`, imported rather than retyped — so the first real run
 * shows the user the same words in the same order this did.
 *
 * Mounted only during the beat it belongs to, so the interval starts and stops
 * with that beat and needs no phase prop to guard it.
 */
function Stages({ lines, ms }: { lines: readonly string[]; ms: number }) {
  const i = useTicker(ms);

  // Clamped, not wrapped: the last line should still be on screen when the
  // result replaces it, rather than restarting the list under the reader.
  const stage = lines[Math.min(i, lines.length - 1)];

  return (
    <View style={styles.stages}>
      <Animated.Text key={stage} entering={FadeIn.duration(220)} style={styles.stageText}>
        {stage}
      </Animated.Text>
      <View style={styles.stageTrack}>
        {lines.map((s, n) => (
          <View key={s} style={[styles.stageTick, n <= i && styles.stageTickOn]} />
        ))}
      </View>
    </View>
  );
}

function DemoPage({
  width,
  visualH,
  gutter,
  top,
  live,
  reduceMotion,
}: {
  width: number;
  visualH: number;
  gutter: number;
  top: number;
  live: boolean;
  reduceMotion: boolean | null;
}) {
  const { phase } = usePhaseLoop(PHASES, HOLD, live, reduceMotion);

  /*
   * Derived from the shared visual height so the chat card is exactly as tall
   * as the tour pages' hero band — that equality is the point of `visualHeight`
   * and a hardcoded number here would quietly break it. The thread gets
   * whatever the bar and composer do not, and the messages are taller than
   * that, so the oldest clip off the top behind the fade.
   */
  const threadH = visualH - CARD_CHROME;

  /**
   * 0 → 1 across the whole 'think' phase, and the master clock for all three of
   * its beats. One linear value with the beats carved out by `interpolate` is
   * easier to retime than three chained `withSequence`s, because the ranges
   * below read as a storyboard.
   */
  const scan = useSharedValue(0);
  useEffect(() => {
    if (phase !== 'think') {
      scan.value = 0;
      return;
    }
    scan.value = withTiming(1, { duration: HOLD.think, easing: Easing.linear });
  }, [phase, scan]);

  /*
   *   0.00 → 0.30   scroll back through the history
   *   0.30 → 0.80   sweep the revealed thread
   *   0.80 → 1.00   scroll forward again, putting her back where she was
   *
   * The return leg is not a flourish. The real service scrolls the user's chat
   * forward again after reading (`ACTION_SCROLL_FORWARD`), and a demo that read
   * the history and then just left them scrolled up would be showing worse
   * behaviour than the app actually has.
   */
  const reveal = useDerivedValue(() =>
    interpolate(scan.value, [0, 0.3, 0.8, 1], [0, REVEAL, REVEAL, 0], Extrapolation.CLAMP),
  );
  /** The sweep's own 0 → 1, so the bubble highlights stay on their own clock. */
  const sweep = useDerivedValue(() =>
    interpolate(scan.value, [0.3, 0.8], [0, 1], Extrapolation.CLAMP),
  );

  // The clock is deliberately linear, so each beat keeps exactly the share of
  // the duration the ranges above give it. Easing the clock instead would
  // stretch the scroll and squash the sweep, or the reverse, depending on which
  // curve — and the beats would no longer match what the ranges say.
  const threadInnerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reveal.value }],
  }));
  const scanStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [0, 0.08, 0.9, 1], [0, 1, 1, 0]),
    transform: [{ translateY: sweep.value * threadH }],
  }));

  const at = (p: Phase): boolean => PHASES.indexOf(phase) >= PHASES.indexOf(p);

  return (
    <Page
      width={width}
      gutter={gutter}
      top={top}
      kicker="Here is the whole thing"
      title={'Never stare at\na chat again.'}
      facts={DEMO_FACTS}
      /*
        Keyed on the phase so it cross-fades instead of swapping text under the
        reader mid-sentence. This is the page's body copy — the other three
        pages pass a plain string here.
      */
      body={
        <View style={styles.captionBox}>
          <Animated.Text key={phase} entering={FadeIn.duration(260)} style={styles.body}>
            {CAPTION[phase]}
          </Animated.Text>
        </View>
      }
    >
      {/*
        The mock. Deliberately NOT a screenshot of a real dating app — using one
        would put another company's UI and trade dress in our onboarding and in
        our store listing. This reads as "a chat", which is all it has to do.
      */}
      <View style={[styles.phone, { height: visualH }]}>
        <View style={styles.phoneBar}>
          <Image source={AVATARS.maya} style={styles.avatar} contentFit="cover" />
          <Text style={styles.phoneName}>Maya</Text>
          <View style={styles.online} />
        </View>

        <View style={[styles.thread, { height: threadH }]}>
          {/* Anchored to the bottom and translated DOWN to scroll back: moving
              the content down is what brings older messages into the box. */}
          <Animated.View style={[styles.threadInner, threadInnerStyle]}>
            {THREAD.map((line, i) => (
              <Bubble
                key={line.text}
                line={line}
                scan={sweep}
                /* Where in the sweep this bubble lights up. The line travels top
                   to bottom, so it is just this message's position in the thread
                   — offset by one so the first bubble's peak is never at
                   `sweep === 0`, the resting value. See the note in `Bubble`. */
                at={(i + 1) / (THREAD.length + 1)}
              />
            ))}
          </Animated.View>

          {/* Implies the conversation continues above the box. The thread is
              taller than its container and bottom-aligned, so old messages
              genuinely clip — this only softens the cut. */}
          <LinearGradient
            colors={[palette.surface, `${palette.surface}00`]}
            style={styles.threadFade}
            pointerEvents="none"
          />

          {/* The context scan. Runs only during 'think'. */}
          <Animated.View style={[styles.scanLine, scanStyle]} pointerEvents="none">
            <LinearGradient
              colors={[`${palette.violetBright}00`, palette.violetBright, `${palette.violetBright}00`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        {/*
          Her composer, and it stays empty for the entire loop.

          The reply used to type itself in here and the last caption read
          "Pasted in. Send it." That was a promise the app does not keep:
          `RizzAccessibilityService` calls `copyToClipboard(result.reply)` and
          toasts "✨ Reply copied — paste & send". It never writes into the host
          app and never sends. Showing the text land in her chat window would
          have advertised an autonomous action — the exact capability the Play
          accessibility declaration says the service does not have.
        */}
        <View style={styles.composer}>
          <View style={styles.field}>
            <Text style={styles.fieldPlaceholder} numberOfLines={1}>
              Message…
            </Text>
          </View>
          <View style={styles.send}>
            <Ionicons name="arrow-up" size={15} color={palette.textTertiary} />
          </View>

          {/* The ✨ overlay button — the thing this whole page is explaining. */}
          {at('tap') && !at('type') && (
            <Animated.View entering={ZoomIn.duration(300)} style={styles.sparkle}>
              <Text style={styles.sparkleGlyph}>✨</Text>
            </Animated.View>
          )}
          {phase === 'tap' && (
            <Animated.View pointerEvents="none" entering={ZoomIn.duration(700)} style={styles.ripple} />
          )}
        </View>

        {/*
          RizzCoach's own sheet, over her app — which is what the bubble really
          produces. It covers the composer rather than filling it, so the two
          surfaces stay visibly separate: her chat underneath, our result on top.
        */}
        {at('type') && (
          <Animated.View entering={FadeInUp.duration(280)} style={styles.result}>
            <View style={styles.resultBar}>
              <Text style={styles.sparkleGlyph}>✨</Text>
              <Text style={styles.resultTitle}>RizzCoach</Text>
              {at('done') && (
                <Animated.View entering={FadeIn.duration(240)} style={styles.copied}>
                  <Ionicons name="copy-outline" size={11} color={palette.mint} />
                  <Text style={styles.copiedText}>Copied</Text>
                </Animated.View>
              )}
            </View>
            {/* Keyed on the phase so the reveal counter resets by remounting
                rather than by an effect writing state back on every change. */}
            <ReplyText key={phase} phase={phase} />
          </Animated.View>
        )}
      </View>
    </Page>
  );
}

/**
 * One message, which lights up violet as the scan line passes over it.
 *
 * That highlight is the whole reason the scan is legible: a line sweeping over
 * static bubbles reads as a loading bar, whereas bubbles reacting to it read as
 * something being *taken in*. `at` is where in the sweep this one sits.
 *
 * The border is drawn always and only its colour animates. Toggling `borderWidth`
 * instead would reflow the bubble — every message would twitch a pixel wider as
 * the line reached it.
 */
function Bubble({ line, scan, at }: { line: Line; scan: SharedValue<number>; at: number }) {
  const mine = line.from === 'me';
  /*
   * The window is deliberately asymmetric and bounded away from BOTH ends of
   * the sweep, and both edges are load bearing.
   *
   * `at` never reaches 0 (see the call site), so at rest — `scan.value === 0`,
   * which is every phase but 'think' — the clamp puts the first bubble at 0
   * rather than at its peak. A window starting at exactly 0 leaves the top
   * message permanently outlined violet, as though the app were mid-scan while
   * sitting still.
   *
   * And the last window closes before `scan` reaches 1, so every highlight has
   * finished fading by the time the phase flips and `scan` snaps back to 0.
   * Otherwise the bottom message loses a half-lit border in a single frame.
   */
  const style = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      interpolate(scan.value, [at - 0.1, at, at + 0.15], [0, 1, 0], Extrapolation.CLAMP),
      [0, 1],
      ['rgba(255,255,255,0)', palette.violetBright],
    ),
  }));

  return (
    <Animated.View style={[mine ? styles.myBubble : styles.theirBubble, styles.scannable, style]}>
      <Text style={mine ? styles.myText : styles.theirText}>{line.text}</Text>
    </Animated.View>
  );
}

/**
 * Isolated so the per-character reveal re-renders one `<Text>` rather than the
 * whole page sixty-odd times. Two characters a tick keeps the tick count near
 * thirty-five for the phase's whole budget while still reading as typing.
 *
 * Mounted with `key={phase}`, so `n` starts at 0 for every phase and no effect
 * has to reset it — the reveal state simply does not survive a phase change.
 */
function ReplyText({ phase }: { phase: Phase }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (phase !== 'type') return;
    const id = setInterval(
      () => {
        setN((prev) => {
          if (prev >= REPLY.length) {
            clearInterval(id);
            return prev;
          }
          return prev + 2;
        });
      },
      (HOLD.type / REPLY.length) * 2,
    );
    return () => clearInterval(id);
  }, [phase]);

  return (
    <Text style={styles.resultText}>{phase === 'done' ? REPLY : REPLY.slice(0, n)}</Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.ink },
  pager: { flex: 1 },
  page: { flex: 1 },

  kicker: { ...type.overline, color: palette.violetBright, marginBottom: spacing.sm },
  title: { ...type.hero },
  body: { ...type.bodyMuted },
  copy: { marginTop: spacing.lg, gap: spacing.sm + 2 },

  // A wrapping row of chips rather than a stacked list: three of these cost one
  // line instead of three, and the height that buys goes to the visual above.
  // Wrapping is allowed rather than reserved for — the spacer below absorbs the
  // difference, so a page whose facts take two rows does not shift the visual.
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
    borderRadius: radii.full,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md - 2,
    paddingVertical: 5,
  },
  factText: { ...type.caption, fontSize: 11, color: palette.textSecondary },

  cardLabel: { ...type.overline, fontSize: 10, color: palette.textTertiary },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  score: { ...type.hero, fontSize: 30, lineHeight: 34, color: palette.mint },
  scoreOf: { ...type.caption, color: palette.textTertiary },
  badge: {
    marginLeft: 'auto',
    alignSelf: 'center',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: { ...type.caption, fontSize: 11, color: palette.textSecondary },

  /* ── The Bio Lab demo ──────────────────────────────────────────────────── */

  bioForm: { flex: 1, gap: 6 },
  sectionLabel: { ...type.overline, fontSize: 10, color: palette.textTertiary, marginTop: 2 },
  // Selected state is a background and a border, never a size change — a chip
  // that grew on selection would reflow the whole wrapping grid under the
  // reader every time one lit up.
  chipOn: { backgroundColor: palette.violetDeep, borderColor: palette.violetBright, borderWidth: 1 },
  chipTextOn: { color: palette.textPrimary },
  writing: { marginTop: 'auto' },
  bioResult: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  toneChip: {
    backgroundColor: palette.violetDeep,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  toneChipText: { ...type.caption, fontSize: 11, color: palette.violetBright },
  bioText: { ...type.body, fontSize: 15, lineHeight: 22 },
  bioActions: { flexDirection: 'row', gap: spacing.sm },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  ghostButtonText: { ...type.caption, fontSize: 12, color: palette.textSecondary },

  /* ── The Lab demo ──────────────────────────────────────────────────────── */

  drop: { flex: 1, gap: spacing.sm },
  // Dashed while empty and solid once filled — the same "put something here"
  // convention as the real `GlowDropZone`, so the affordance the user learns on
  // this page is the one they meet in the app.
  dropZone: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    overflow: 'hidden',
  },
  dropZoneFilled: { borderStyle: 'solid', borderColor: palette.violetDeep },
  dropEmpty: { alignItems: 'center', gap: 6 },
  dropHint: { ...type.caption, color: palette.textTertiary },
  shot: { alignSelf: 'stretch', gap: 5 },
  miniBubble: { maxWidth: '80%', borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 5 },
  miniTheirs: { alignSelf: 'flex-start', backgroundColor: palette.surfaceHigh },
  miniMine: { alignSelf: 'flex-end', backgroundColor: palette.violet },
  miniText: { ...type.caption, fontSize: 10, color: palette.textSecondary },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: palette.violet,
  },
  // Pressed state is opacity, not scale: the button is full width, and scaling
  // it moves both its edges inward, which reads as the layout shifting rather
  // than as a tap.
  uploadButtonDown: { opacity: 0.75 },
  uploadButtonSpent: { opacity: 0.35 },
  uploadText: { ...type.label, fontSize: 14 },
  uploadRipple: {
    ...absoluteFill,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: `${palette.violetBright}66`,
  },
  /*
   * Three replies have to clear the card's 230pt floor, which after `phone`'s
   * padding leaves 198pt of usable height. At `spacing.sm` padding and gaps the
   * stack came to 208 and the third reply — the Bold one, the whole reason to
   * show three — clipped on a small phone. 6pt everywhere brings it to ~192.
   */
  replies: { flex: 1, gap: 6, justifyContent: 'center' },
  reply: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    gap: 3,
  },
  replyText: { ...type.body, fontSize: 12, lineHeight: 16, color: palette.textSecondary },
  // Three pips always drawn and filled to the level, rather than a variable
  // count — `spice` is a scale, and a scale needs its own maximum on screen to
  // be read as one.
  spice: { flexDirection: 'row', gap: 3, marginLeft: 'auto' },
  pip: { width: 5, height: 5, borderRadius: radii.full, backgroundColor: palette.hairlineStrong },
  pipOn: { backgroundColor: palette.gold },

  /* ── The profile-scan demo ─────────────────────────────────────────────── */

  // Layered on `phone`, which supplies the card frame both demos share. The
  // padding is dropped because the photo is full-bleed here — the copy carries
  // its own inset instead.
  profile: { padding: 0, justifyContent: 'flex-end' },
  // Bottom-weighted like the tour pages' scrim and for the same reason: the
  // name and bio sit at the bottom of the photo, and a flat overlay would mute
  // the whole image to protect one corner of it.
  profileScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '30%',
    backgroundColor: 'rgba(10,10,18,0.78)',
  },
  profileCopy: { padding: spacing.md, gap: 6 },
  profileName: { ...type.h2, fontSize: 22 },
  profileTag: { ...type.caption, color: palette.textTertiary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  chipText: { ...type.caption, fontSize: 11, color: palette.textSecondary },
  profileBio: { ...type.body, fontSize: 13, lineHeight: 19, color: palette.textSecondary },

  /*
   * The app switch. It covers the ENTIRE card rather than sliding up inside it,
   * because a bubble tap on a profile ends in `launchApp()` — RizzCoach comes to
   * the foreground and draws this itself. Compare `result` on the chat demo,
   * which is deliberately a partial cover: that one really is our sheet sitting
   * over someone else's app.
   */
  report: {
    ...absoluteFill,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    // Tighter than the horizontal padding on purpose. Stacked up, the bar, two
    // scores with a note each and the opener come to almost exactly the card's
    // 230pt floor, and the vertical padding is the one place to find slack that
    // costs nothing to read.
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  reportMode: { ...type.caption, fontSize: 11, color: palette.textTertiary, marginLeft: 'auto' },
  reportBody: { gap: spacing.sm, flex: 1 },
  scoreLine: { gap: 1 },
  // Two scores, a note each and an opener all have to clear the card's floor
  // height (230pt) without clipping, and the score is the cheapest thing to buy
  // that room from — it is still the biggest number on the sheet.
  reportScore: { fontSize: 22, lineHeight: 26 },
  scoreNote: { ...type.caption, fontSize: 11, color: palette.textTertiary },
  opener: {
    marginTop: 'auto',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.violetDeep,
    padding: spacing.sm + 2,
    gap: 4,
  },
  openerBar: { flexDirection: 'row', alignItems: 'center' },

  stages: { flex: 1, justifyContent: 'center', gap: spacing.md },
  stageText: { ...type.body, fontSize: 14, color: palette.textSecondary, textAlign: 'center' },
  // Ticks rather than a filling bar: the work is four discrete passes, and a
  // smooth bar would be inventing a completion percentage nothing measures.
  stageTrack: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
  stageTick: { width: 22, height: 3, borderRadius: radii.full, backgroundColor: palette.hairlineStrong },
  stageTickOn: { backgroundColor: palette.violetBright },

  phone: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.md,
    gap: spacing.md,
    overflow: 'hidden',
  },
  phoneBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 26, height: 26, borderRadius: radii.full, backgroundColor: palette.surfaceHigh },
  phoneName: { ...type.label },
  online: { width: 6, height: 6, borderRadius: radii.full, backgroundColor: palette.mint },

  /*
   * Fixed height (passed in, derived from the shared visual height) and
   * clipped. The thread is TALLER than this and bottom-aligned, so the oldest
   * messages clip off the top behind the fade — which is what sells it as a
   * conversation already in progress rather than one that starts where the box
   * does. `flex: 1` would defeat that by shrinking the messages to fit.
   */
  thread: { overflow: 'hidden' },
  // Absolutely bottom-anchored rather than laid out with `justifyContent`,
  // because it has to be free to translate DOWN past the box's bottom edge —
  // which is what scrolling back through the history looks like from here.
  threadInner: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: spacing.sm },
  threadFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 40 },
  scanLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  // Always drawn, so only the colour animates: toggling borderWidth would
  // reflow each bubble a pixel wider as the scan line reached it.
  scannable: { borderWidth: 1, borderColor: 'rgba(255,255,255,0)' },
  theirBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.lg,
    borderBottomLeftRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  theirText: { ...type.body, fontSize: 14, lineHeight: 20 },
  myBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: palette.violet,
    borderRadius: radii.lg,
    borderBottomRightRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  myText: { ...type.body, fontSize: 14, lineHeight: 20 },

  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  fieldPlaceholder: { ...type.body, fontSize: 14, color: palette.textTertiary },
  send: {
    width: 34,
    height: 34,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
  },

  /*
   * Our sheet, sitting OVER her composer rather than inside it. The separation
   * is the honest part: the reply lands on the clipboard, not in her app, so
   * the two surfaces must not look like one. Anchored to the card's bottom
   * edge; `overflow: hidden` on `phone` keeps its corners inside the radius.
   */
  result: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.surfaceHigh,
    borderTopWidth: 1,
    borderTopColor: palette.violetDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 6,
  },
  resultBar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultTitle: { ...type.overline, fontSize: 10, color: palette.violetBright },
  resultText: { ...type.body, fontSize: 14, lineHeight: 19, minHeight: 38 },
  copied: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${palette.mint}22`,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  copiedText: { ...type.caption, fontSize: 11, color: palette.mint },

  sparkle: {
    position: 'absolute',
    right: 42,
    bottom: 42,
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.violetDeep,
    borderWidth: 1,
    borderColor: palette.violetBright,
    ...glow(palette.violet, 0.6, 16),
  },
  sparkleGlyph: { fontSize: 18 },
  ripple: {
    position: 'absolute',
    right: 32,
    bottom: 32,
    width: 60,
    height: 60,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: `${palette.violetBright}66`,
  },

  // Holds two lines of body copy. The demo's caption changes every phase and
  // wraps differently at each one, so without a reserved box the facts below it
  // would hop up and down on every beat of the loop.
  captionBox: { minHeight: 44 },

  // Takes up whatever the visual and copy do not, so the copy sits directly
  // under the visual instead of being spread down the page.
  spacer: { flex: 1 },

  // Outside the pager, so the CTA and the dots stay put while the pages move
  // under them. A per-page copy would slide the button off screen mid-swipe.
  footer: { gap: spacing.md, paddingTop: spacing.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: radii.full, backgroundColor: palette.hairlineStrong },
  dotOn: { backgroundColor: palette.violetBright, width: 18 },

  cta: {
    height: 54,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.violet,
    ...glow(palette.violet, 0.4, 20),
  },
  ctaText: { ...type.h3, fontSize: 17 },
  footnote: { ...type.caption, color: palette.textTertiary, textAlign: 'center' },
});
