import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiNotice } from '@/components/feature/AiNotice';
import { ABSimulator } from '@/components/feature/ABSimulator';
import { AnalyzingOverlay } from '@/components/feature/AnalyzingOverlay';
import { BubbleStrip } from '@/components/feature/BubbleStrip';
import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { GlowDropZone } from '@/components/ui/GlowDropZone';
import { ModeSelector } from '@/components/ui/ModeSelector';
import { ProUpsellCard } from '@/components/feature/ProUpsellCard';
import { ReplyCard } from '@/components/feature/ReplyCard';
import { RoastCard } from '@/components/feature/RoastCard';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { TheRead } from '@/components/feature/TheRead';
import { useToast } from '@/components/ui/Toast';
import { VibeCheckCard } from '@/components/feature/VibeCheckCard';
import { APP_NAME } from '@/constants';
import { BG } from '@/data/assets';
import { ANALYZE_STAGES } from '@/services/engine';
import { analyzeScreenshot, type EngineInput } from '@/services/engine';
import { useOutOfCredits, useRizzStore } from '@/state/useRizzStore';
import { useLayout, useTabBarClearance } from '@/theme/layout';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { AnalysisResult, EngineMode, ReplyOption } from '@/types';
import { haptic } from '@/utils/haptics';
import { copyLine, shareText } from '@/utils/misc';
import { useBackToIdle } from '@/hooks/useBackToIdle';
import { useAiConsent } from '@/hooks/useAiConsent';
import { useCreditGate } from '@/hooks/useCreditGate';
import { useStagedProgress } from '@/hooks/useStagedProgress';

type Phase = 'idle' | 'analyzing' | 'done';

export default function LabScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const bottomClearance = useTabBarClearance();
  const toast = useToast();

  const [mode, setMode] = useState<EngineMode>('rizz');
  const [phase, setPhase] = useState<Phase>('idle');
  const [imageUri, setImageUri] = useState<string | null>(null);
  /** One result per mode — switching modes must not re-ask for what we have. */
  const [results, setResults] = useState<Partial<Record<EngineMode, AnalysisResult>>>({});
  const { stage, start: startStages, stop: stopStages } = useStagedProgress(ANALYZE_STAGES.length, 850);
  /** The picked screenshot, kept so mode switches and rerolls can re-ask. */
  const shot = useRef<EngineInput | null>(null);
  /** A credit is spent per screenshot, not per analysis — see chargeOnce below. */
  const charged = useRef(false);

  const result = results[mode] ?? null;

  const savedItems = useRizzStore((state) => state.savedItems);
  const incrementAnalysis = useRizzStore((state) => state.incrementAnalysis);
  const toggleSave = useRizzStore((state) => state.toggleSave);

  const outOfCredits = useOutOfCredits();
  const creditGate = useCreditGate();
  const needsAiConsent = useAiConsent();

  /** Run one mode against the held screenshot. `onFail` restores the prior view. */
  const runAnalysis = useCallback(
    async (targetMode: EngineMode, temperature?: number, onFail?: () => void) => {
      const input = shot.current;
      if (!input) return;

      setPhase('analyzing');
      startStages();

      try {
        const analysis = await analyzeScreenshot(input, targetMode, temperature);
        setResults((previous) => ({ ...previous, [targetMode]: analysis }));
        setPhase('done');
        // Release raw base64 string bytes to free RAM once successfully analyzed
        if (shot.current) {
          shot.current = { ...shot.current, base64: '' };
        }
        // The first success on a screenshot buys every mode and reroll of it.
        if (!charged.current) {
          charged.current = true;
          incrementAnalysis();
        }
        haptic.success();
      } catch (error) {
        console.warn('[lab] analysis failed', error);
        toast.show('The engine choked — try again', { tone: 'error' });
        if (charged.current) {
          setPhase('done');
          onFail?.();
        } else {
          setPhase('idle');
          setImageUri(null);
          shot.current = null;
        }
      } finally {
        stopStages();
      }
    },
    [incrementAnalysis, toast, startStages, stopStages],
  );

  const pickScreenshot = useCallback(async () => {
    if (needsAiConsent('lab')) return;
    if (creditGate('out_of_credits', 'lab')) return;

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      base64: true,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;

    haptic.medium();
    setImageUri(asset.uri);
    setResults({});
    charged.current = false;
    shot.current = { base64: asset.base64 ?? '', mimeType: asset.mimeType ?? 'image/jpeg' };
    void runAnalysis(mode);
  }, [needsAiConsent, creditGate, mode, runAnalysis]);

  /** Switching modes analyses on demand — free, the screenshot already paid. */
  const changeMode = (next: EngineMode) => {
    const previous = mode;
    setMode(next);
    if (!shot.current || results[next]) return;
    void runAnalysis(next, undefined, () => setMode(previous));
  };

  /** "Give me another" — same screenshot, hotter model, no credit. */
  const reroll = () => {
    haptic.medium();
    void runAnalysis(mode, 1.15);
  };

  // useCallback so useBackToIdle's listener does not resubscribe every render.
  const reset = useCallback(() => {
    haptic.light();
    setPhase('idle');
    setImageUri(null);
    setResults({});
    shot.current = null;
    charged.current = false;
  }, []);

  // Android back closes the result instead of exiting the app. See useBackToIdle.
  useBackToIdle(phase === 'done', reset);

  const copyText = (text: string) => copyLine(text, toast.show);

  const shareRoast = async () => {
    if (!result?.roast) return;
    haptic.medium();
    const outcome = await shareText(`${result.roast.text}\n\n— roasted by ${APP_NAME} 🔥`);
    if (outcome === 'copied') toast.show("Copied. Go get 'em.");
  };

  const toggleSaveReply = (option: ReplyOption) => {
    if (!result) return;
    haptic.light();
    toggleSave({
      id: `engine-${result.id}-${option.id}`,
      text: option.text,
      category: 'Engine',
    });
  };

  const isReplySaved = (option: ReplyOption) =>
    result != null && savedItems.some((item) => item.id === `engine-${result.id}-${option.id}`);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            paddingTop: insets.top + spacing.sm,
            paddingBottom: bottomClearance,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader icon="flash" title={APP_NAME} tint={palette.violetBright} />

        {/* Hero copy */}
        {phase === 'idle' && (
          <View style={styles.hero}>
            {/* Hard line break + a display size: cap the scale or it overflows
                the gutter on a small phone at large accessibility text sizes. */}
            <Text style={styles.heroTitle} maxFontSizeMultiplier={1.25}>
              Turn screenshots{'\n'}into second dates.
            </Text>
            <Text style={styles.heroSub}>Drop a chat. The engine handles the rest.</Text>
          </View>
        )}

        <ModeSelector mode={mode} onChange={changeMode} />

        {/* Engine states */}
        {phase === 'idle' && (
          <GlowDropZone
            onPress={pickScreenshot}
            locked={outOfCredits}
            title="Drop your screenshot"
            subtitle="Upload any chat. Get the perfect line back."
            accent={[palette.violet, palette.pink]}
            background={BG.violet}
          />
        )}

        {/* The moat, one line, under the primary action and never over it. */}
        {phase === 'idle' && <BubbleStrip />}

        {phase === 'analyzing' && imageUri != null && (
          <AnalyzingOverlay uri={imageUri} stage={stage} />
        )}

        {phase === 'done' && result != null && (
          <View style={styles.results}>
            {/*
              Evidence, then context, then output.

              The order used to be the other way round: a decorative header ("The
              read is in" over a 46pt thumbnail) came first and the quote the
              engine is actually answering came second, at body size, in grey.
              That buried the one thing separating this from a line generator —
              see TheRead. The header stays because it carries reroll and reset,
              but it is now a caption, not a headline.
            */}
            {result.read != null && <TheRead read={result.read} />}

            <Animated.View entering={FadeInDown.springify().damping(17)} style={styles.resultHeader}>
              {imageUri != null && (
                <Image source={{ uri: imageUri }} style={styles.thumb} contentFit="cover" />
              )}
              <Text style={styles.resultSub}>
                {mode === 'rizz'
                  ? '3 replies, ranked by vibe'
                  : mode === 'vibe'
                    ? 'Their texting psyche, decoded'
                    : 'Your texting, on trial'}
              </Text>
              <CircleIconButton
                icon="sparkles"
                size={38}
                onPress={reroll}
                accessibilityLabel="Regenerate — give me another take"
              />
              <CircleIconButton
                icon="refresh"
                size={38}
                onPress={reset}
                accessibilityLabel="Start a new analysis"
              />
            </Animated.View>

            {mode === 'rizz' && result.replies != null && (
              <>
                {result.replies.map((option, index) => (
                  <ReplyCard
                    key={option.id}
                    option={option}
                    index={index}
                    saved={isReplySaved(option)}
                    onCopy={() => void copyText(option.text)}
                    onToggleSave={() => toggleSaveReply(option)}
                  />
                ))}
                {result.sims != null && result.sims.length > 0 && (
                  <ABSimulator replies={result.replies} sims={result.sims} />
                )}
              </>
            )}

            {mode === 'vibe' && result.vibe != null && <VibeCheckCard vibe={result.vibe} />}

            {mode === 'roast' && result.roast != null && (
              <RoastCard roast={result.roast} onShare={() => void shareRoast()} />
            )}

            {outOfCredits && <ProUpsellCard onPress={() => router.push('/paywall?source=upsell_card')} />}
          </View>
        )}

        {/* Where the screenshot actually goes — see components/AiNotice.tsx */}
        {phase !== 'done' && <AiNotice tool="lab" />}
      </ScrollView>

      {toast.element}
    </View>
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
  results: {
    gap: spacing.md,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // Smaller than the old 46: the screenshot is a reminder of what was analysed,
  // not the subject of the screen. The quote above it is.
  thumb: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  resultSub: {
    ...typo.caption,
    flex: 1,
  },
});
