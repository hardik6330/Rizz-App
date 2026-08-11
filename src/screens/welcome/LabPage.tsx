import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { ANALYZE_STAGES } from '@/data/mockAnalysis';
import { palette } from '@/theme/tokens';
import type { ReplyStyle } from '@/types';
import { Page, Stages, usePhaseLoop, type Line, type PageProps } from './shared';
import { styles } from './styles';

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

const LAB_FACTS = ['From a screenshot', 'Three styles', 'Save what lands'];

/**
 * Demo 2 of 4 — the Lab, which is the tab a new user actually lands on.
 *
 * It replaced a Vault still. The Vault is somewhere you go once you already
 * have lines worth keeping, and a screen shown before signup has to earn its
 * page against the thing the user will open first.
 */
export function LabPage({ width, visualH, gutter, top, live, reduceMotion }: PageProps) {
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
