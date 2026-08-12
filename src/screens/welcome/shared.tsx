import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { palette, spacing } from '@/theme/tokens';
import { styles } from './styles';

/** Layout, clock and chrome shared by all four welcome demo pages. */

/** One message in a mocked thread. Shared by the Lab and chat demos. */
export interface Line {
  from: 'them' | 'me';
  text: string;
}

/** Every page gets the same props — the pager passes them straight through. */
export interface PageProps {
  width: number;
  visualH: number;
  gutter: number;
  top: number;
  /** False for pages the user is not looking at, so their timers do not run. */
  live: boolean;
  reduceMotion: boolean;
}

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
export function visualHeight(windowHeight: number): number {
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
export const CARD_CHROME = 114;

/**
 * Longest the opening frame is allowed to sit still before a first-time viewer
 * sees anything move.
 *
 * The authored holds are written for a loop that is already running, where the
 * first phase is a reset beat between the payoff and the next pass. On arrival
 * it is not a beat, it is dead air: `ScanPage.card` and `DemoPage.chat` are both
 * **2400ms**, so landing on either page — or swiping to it, on top of the scroll
 * settling first — showed a completely static card for nearly two and a half
 * seconds, which reads as a screen that has failed to load rather than as a demo
 * about to start. 800ms is what `BioPage.blank` and `LabPage.empty` already use
 * and what their comments describe: long enough to let the eye land, short
 * enough that nobody wonders whether it is broken.
 *
 * Only the first pass is capped. Once the user has seen the payoff, the long
 * reset beat is doing its job and stays.
 */
const LEAD_IN_MS = 800;

function waitFor<P extends string>(
  phases: readonly P[],
  hold: Record<P, number>,
  phase: P,
  cycle: number,
): number {
  const opening = cycle === 0 && phases.indexOf(phase) === 0;
  return opening ? Math.min(hold[phase], LEAD_IN_MS) : hold[phase];
}

/**
 * The clock both demo pages run on.
 *
 * One hook rather than a copy of the timer per page, because the two loops have
 * to agree about the two things that are easy to get subtly wrong: they only
 * tick on the page the user is actually looking at (otherwise every demo burns
 * a timer and a re-render behind the others from the app's first frame), and
 * they do not start at all when Reduce Motion is on. The value is seeded
 * synchronously in `welcome.tsx` — see the note there for why an async answer
 * made every demo's first beat late.
 *
 * Returns the phase to RENDER, which is the held final frame under Reduce
 * Motion. Derived rather than stored, so there is no second piece of state for
 * the effect to keep in sync.
 *
 * See `LEAD_IN_MS` for why the opening frame is not held for as long as it says.
 */
export function usePhaseLoop<P extends string>(
  phases: readonly P[],
  hold: Record<P, number>,
  live: boolean,
  reduceMotion: boolean,
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
    if (reduceMotion || !live) return;
    const i = phases.indexOf(loopPhase);
    const wrapping = i === phases.length - 1;
    const t = setTimeout(() => {
      setLoopPhase(phases[(i + 1) % phases.length]);
      // Bumped on the wrap, not on mount, so the FIRST pass is always variant 0
      // — otherwise which example a user sees first depends on timing.
      if (wrapping) setCycle((c) => c + 1);
    }, waitFor(phases, hold, loopPhase, cycle));
    return () => clearTimeout(t);
  }, [loopPhase, cycle, reduceMotion, live, phases, hold]);

  /*
   * The last phase, not the first. Every demo ends on its payoff — the copied
   * reply, the finished report, the written bio — so a user who has turned
   * animation off gets the answer rather than an empty chat or a blank form.
   */
  return { phase: reduceMotion ? phases[phases.length - 1] : loopPhase, cycle };
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
export function Page({
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
 * A counter that increments every `ms`, for the sub-beats inside a phase.
 *
 * Deliberately not a shared value: everything driven off it is text or a
 * discrete swap, which has to cross to the JS thread anyway.
 */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
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
export function Stages({ lines, ms }: { lines: readonly string[]; ms: number }) {
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
