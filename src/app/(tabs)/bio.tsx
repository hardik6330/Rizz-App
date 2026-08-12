import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { AiNotice } from '@/components/feature/AiNotice';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { INTERESTS } from '@/data/interests';
import { ProUpsellCard } from '@/components/feature/ProUpsellCard';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StagedLoader } from '@/components/ui/StagedLoader';
import { useToast } from '@/components/ui/Toast';
import { BIO_STAGES, optimizeBio } from '@/services/bioEngine';
import { useOutOfCredits, useRizzStore } from '@/state/useRizzStore';
import { useLayout, useTabBarClearance } from '@/theme/layout';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { BioOption, BioResult, BioVibe } from '@/types';
import { haptic } from '@/utils/haptics';
import { copyLine } from '@/utils/misc';
import { useBackToIdle } from '@/hooks/useBackToIdle';
import { useAiConsent } from '@/hooks/useAiConsent';
import { useCreditGate } from '@/hooks/useCreditGate';
import { useKeyboardReveal } from '@/hooks/useKeyboardReveal';
import { useStagedProgress } from '@/hooks/useStagedProgress';

type Phase = 'idle' | 'working' | 'done';

const VIBES: BioVibe[] = ['Funny', 'Sarcastic', 'Chill', 'Ambitious'];

export default function BioScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const bottomClearance = useTabBarClearance();
  /** Android has no keyboard handling of its own here — see the hook. */
  /** The multiline bio box sits low on the page — see the hook. */
  const scroller = useRef<ScrollView>(null);
  const { inset: kbInset, onFocus: onFieldFocus, onScroll } = useKeyboardReveal(scroller);
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>('idle');
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [vibe, setVibe] = useState<BioVibe>('Funny');
  const [currentBio, setCurrentBio] = useState('');
  const [result, setResult] = useState<BioResult | null>(null);
  const { stage, start: startStages, stop: stopStages } = useStagedProgress(BIO_STAGES.length, 1600);

  const savedItems = useRizzStore((state) => state.savedItems);
  const incrementAnalysis = useRizzStore((state) => state.incrementAnalysis);
  const toggleSave = useRizzStore((state) => state.toggleSave);

  const outOfCredits = useOutOfCredits();
  const creditGate = useCreditGate();
  const needsAiConsent = useAiConsent();

  const interests = useMemo(() => {
    const extras = custom
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...selected, ...extras];
  }, [selected, custom]);

  const canOptimize = interests.length > 0;

  const toggleInterest = (label: string) => {
    haptic.selection();
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  const optimize = useCallback(async () => {
    if (needsAiConsent('bio')) return;
    if (creditGate('out_of_credits', 'bio')) return;
    if (!canOptimize) {
      toast.show('Pick at least one interest', { tone: 'error' });
      return;
    }

    haptic.medium();
    setResult(null);
    setPhase('working');
    startStages();

    try {
      const bio = await optimizeBio({
        interests,
        vibe,
        currentBio: currentBio.trim() || undefined,
      });
      setResult(bio);
      setPhase('done');
      incrementAnalysis();
      haptic.success();
    } catch (error) {
      console.warn('[bio] optimize failed', error);
      toast.show('The engine choked — try again', { tone: 'error' });
      setPhase('idle');
    } finally {
      stopStages();
    }
  }, [
    needsAiConsent,
    creditGate,
    canOptimize,
    interests,
    vibe,
    currentBio,
    incrementAnalysis,
    toast,
    startStages,
    stopStages,
  ]);

  // useCallback so useBackToIdle's listener does not resubscribe every render.
  const reset = useCallback(() => {
    haptic.light();
    setPhase('idle');
    setResult(null);
  }, []);

  // Android back closes the result instead of exiting the app. See useBackToIdle.
  useBackToIdle(phase === 'done', reset);

  const copyBio = (text: string) => copyLine(text, toast.show, 'Copied. Go be irresistible.');

  const toggleSaveBio = (option: BioOption) => {
    if (!result) return;
    haptic.light();
    toggleSave({
      id: `bio-${result.id}-${option.id}`,
      text: option.text,
      category: 'Bio',
    });
  };

  const isBioSaved = (option: BioOption) =>
    result != null && savedItems.some((item) => item.id === `bio-${result.id}-${option.id}`);

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            paddingTop: insets.top + spacing.sm,
            // Keyboard up: its height replaces the tab-bar clearance, since the
            // tab bar is behind the keyboard and paying for both leaves a gap.
            paddingBottom: kbInset > 0 ? kbInset + spacing.xl : bottomClearance,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        /*
         * This is the only tab with text inputs, and the multiline "current bio"
         * field sits at the very bottom — the keyboard covered it outright.
         *
         * The line that used to be here said "Android already gets this from
         * adjustResize". That stopped being true: under the edge-to-edge display
         * Expo SDK 54+ and RN 0.86 enforce, the window no longer resizes when the
         * keyboard opens, so this iOS-only prop was the ONLY keyboard handling on
         * the screen and Android had none. `kbInset` above is the Android half.
         */
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader icon="person" title="Bio Lab" tint={palette.mint} />

        {phase === 'done' && result != null ? (
          <View style={styles.results}>
            <Animated.View
              entering={FadeInDown.springify().damping(17)}
              style={styles.resultHeader}
            >
              <View style={styles.resultHeaderText}>
                <Text style={styles.resultTitle}>Three bios, ready to steal</Text>
                <Text style={styles.resultSub}>Copy your favourite or save it to the vault</Text>
              </View>
              <CircleIconButton
                icon="refresh"
                size={38}
                onPress={reset}
                accessibilityLabel="Write new bios"
              />
            </Animated.View>

            {result.bios.map((option, index) => (
              <BioCard
                key={option.id}
                option={option}
                index={index}
                saved={isBioSaved(option)}
                onCopy={() => void copyBio(option.text)}
                onToggleSave={() => toggleSaveBio(option)}
              />
            ))}

            {outOfCredits && <ProUpsellCard onPress={() => router.push('/paywall?source=upsell_card')} />}
          </View>
        ) : phase === 'working' ? (
          <StagedLoader stages={BIO_STAGES} stage={stage} badge="WRITING" tint={palette.mint} />
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroTitle} maxFontSizeMultiplier={1.25}>
                A bio that gets{'\n'}right-swiped.
              </Text>
              <Text style={styles.heroSub}>Pick a few things you love — the engine writes the rest.</Text>
            </View>

            {/* Interests */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>YOUR INTERESTS</Text>
              <View style={styles.chipWrap}>
                {INTERESTS.map((item) => (
                  <Chip
                    key={item.label}
                    label={item.label}
                    emoji={item.emoji}
                    size="md"
                    accent={palette.mint}
                    on={selected.includes(item.label)}
                    accessibilityRole="checkbox"
                    onPress={() => toggleInterest(item.label)}
                  />
                ))}
              </View>
              <TextInput
                value={custom}
                onChangeText={setCustom}
                onFocus={onFieldFocus}
                placeholder="Add your own, comma separated…"
                placeholderTextColor={palette.textTertiary}
                style={styles.input}
              />
            </View>

            {/* Vibe */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>YOUR VIBE</Text>
              <View style={styles.vibeRow}>
                {VIBES.map((item) => {
                  const active = item === vibe;
                  return (
                    <HapticPressable
                      key={item}
                      feedback="none"
                      accessibilityRole="button"
                      accessibilityLabel={`${item} vibe`}
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        haptic.selection();
                        setVibe(item);
                      }}
                      style={[
                        styles.vibePill,
                        active && {
                          backgroundColor: `${palette.violet}24`,
                          borderColor: `${palette.violet}88`,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.vibeLabel, active && { color: palette.textPrimary }]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.2}
                      >
                        {item}
                      </Text>
                    </HapticPressable>
                  );
                })}
              </View>
            </View>

            {/* Current bio */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CURRENT BIO (OPTIONAL)</Text>
              <TextInput
                value={currentBio}
                onChangeText={setCurrentBio}
                onFocus={onFieldFocus}
                placeholder="Paste your current bio to rewrite it…"
                placeholderTextColor={palette.textTertiary}
                multiline
                style={[styles.input, styles.inputMultiline]}
              />
            </View>

            {/* CTA */}
            <Button
              label={outOfCredits ? 'Unlock more with Pro' : 'Optimize my bio'}
              icon="sparkles"
              variant="accent"
              color={palette.mint}
              disabled={!canOptimize && !outOfCredits}
              onPress={() => void optimize()}
              accessibilityLabel="Optimize my bio"
            />

            <AiNotice tool="bio" />
          </>
        )}
      </ScrollView>

      {toast.element}
    </View>
  );
}

const TONE_COLORS: Record<BioOption['tone'], string> = {
  Playful: palette.pink,
  Sincere: palette.cyan,
  Mysterious: palette.violetBright,
};

interface BioCardProps {
  option: BioOption;
  index: number;
  saved: boolean;
  onCopy: () => void;
  onToggleSave: () => void;
}

function BioCard({ option, index, saved, onCopy, onToggleSave }: BioCardProps) {
  const color = TONE_COLORS[option.tone];
  return (
    <Animated.View
      entering={FadeInDown.delay(90 * index)
        .springify()
        .damping(17)}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.toneChip, { backgroundColor: `${color}1F`, borderColor: `${color}55` }]}>
          <Text style={[styles.toneText, { color }]}>{option.label.toUpperCase()}</Text>
        </View>
        <View style={styles.spacer} />
        <CircleIconButton
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          active={saved}
          activeColor={palette.mint}
          onPress={onToggleSave}
          accessibilityLabel={saved ? 'Remove from vault' : 'Save to vault'}
        />
        <CircleIconButton icon="copy-outline" onPress={onCopy} accessibilityLabel="Copy bio" />
      </View>
      <Text style={styles.cardText}>{option.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.ink,
  },
  scroll: {
    gap: spacing.lg,
  },
  hero: {
    gap: 6,
    marginTop: spacing.sm,
  },
  heroTitle: {
    ...typo.display,
  },
  heroSub: {
    ...typo.bodyMuted,
  },
  section: {
    gap: spacing.md,
  },
  sectionLabel: {
    ...typo.overline,
    textTransform: 'none',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    ...typo.body,
  },
  inputMultiline: {
    minHeight: 90,
    textAlignVertical: 'top',
    lineHeight: 21,
  },
  vibeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  vibePill: {
    flex: 1,
    // Four pills across a 320pt phone: without minWidth 0 the longest label
    // ("Ambitious") forces its pill past its share and pushes the row wide.
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  vibeLabel: {
    // RN defaults flexShrink to 0, so text will not shrink into a bounded pill
    // on its own — and numberOfLines cannot ellipsize what was never bounded.
    ...typo.caption,
    flexShrink: 1,
    fontWeight: '700',
  },
  results: {
    gap: spacing.md,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  resultHeaderText: {
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    ...typo.h3,
    fontWeight: '800',
  },
  resultSub: {
    ...typo.caption,
    fontWeight: '400',
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toneChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  toneText: {
    ...typo.micro,
    letterSpacing: 1.1,
  },
  spacer: {
    flex: 1,
  },
  cardText: {
    ...typo.reply,
  },
});
