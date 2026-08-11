import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';

import { BG } from '@/data/assets';
import { PROFILE_STAGES } from '@/services/profileEngine';
import { palette } from '@/theme/tokens';
import { Page, Stages, usePhaseLoop, type PageProps } from './shared';
import { styles } from './styles';

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


const SCAN_FACTS = ['Theirs or your own', 'Scored out of 10', 'Openers that fit'];

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
export function ScanPage({ width, visualH, gutter, top, live, reduceMotion }: PageProps) {
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
