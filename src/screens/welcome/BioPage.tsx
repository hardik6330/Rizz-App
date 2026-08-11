import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { INTERESTS } from '@/data/interests';
import { palette } from '@/theme/tokens';
import type { BioVibe } from '@/types';
import { Page, useTicker, usePhaseLoop, type PageProps } from './shared';
import { styles } from './styles';

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

/** Each page's `facts` — same rule as everywhere: a claim we have to honour. */
const BIO_FACTS = ['Three versions', 'Rewrites yours', 'Or starts fresh'];

/**
 * The four vibes, mirroring `VIBES` in `(tabs)/bio.tsx`. Typed `BioVibe[]` so a
 * rename in the union breaks this at compile time.
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
export function BioPage({ width, visualH, gutter, top, live, reduceMotion }: PageProps) {
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
