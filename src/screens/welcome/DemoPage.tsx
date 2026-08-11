import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInUp,
  ZoomIn,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { AVATARS } from '@/data/assets';
import { palette } from '@/theme/tokens';
import { CARD_CHROME, Page, usePhaseLoop, type Line, type PageProps } from './shared';
import { styles } from './styles';

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

const DEMO_FACTS = ['Works in your chat app', 'Matches your style', 'Nothing saved'];

export function DemoPage({ width, visualH, gutter, top, live, reduceMotion }: PageProps) {
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
