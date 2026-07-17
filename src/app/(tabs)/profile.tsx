import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/CircleIconButton';
import { GlowDropZone } from '@/components/GlowDropZone';
import { HapticPressable } from '@/components/HapticPressable';
import { ProUpsellCard } from '@/components/ProUpsellCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StagedLoader } from '@/components/StagedLoader';
import { useToast } from '@/components/Toast';
import { BG } from '@/data/assets';
import { PROFILE_LABELS, PROFILE_STAGES, analyzeProfile } from '@/services/profileEngine';
import { useOutOfCredits, useRizzStore } from '@/state/useRizzStore';
import { palette, radii, spacing } from '@/theme/tokens';
import type { ProfileScanResult, ProfileScore, ScanMode } from '@/types';
import { haptic } from '@/utils/haptics';

type Phase = 'idle' | 'working' | 'done';
type Pick = { uri: string; base64: string; mimeType: string };

const MAX_IMAGES = 3;

/** Mode pills. 'self' stays first so the tab opens on the original behaviour. */
const SCAN_MODES: { key: ScanMode; label: string; emoji: string; tint: string }[] = [
  { key: 'self', label: 'My profile', emoji: '✨', tint: palette.cyan },
  { key: 'them', label: 'Their profile', emoji: '🔍', tint: palette.violet },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [mode, setMode] = useState<ScanMode>('self');
  const [phase, setPhase] = useState<Phase>('idle');
  const [images, setImages] = useState<Pick[]>([]);
  const [result, setResult] = useState<ProfileScanResult | null>(null);
  const [stage, setStage] = useState(0);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const labels = PROFILE_LABELS[mode];
  const tint = mode === 'self' ? palette.cyan : palette.violet;

  const savedItems = useRizzStore((state) => state.savedItems);
  const incrementAnalysis = useRizzStore((state) => state.incrementAnalysis);
  const toggleSave = useRizzStore((state) => state.toggleSave);

  const outOfCredits = useOutOfCredits();

  useEffect(
    () => () => {
      if (stageTimer.current) clearInterval(stageTimer.current);
    },
    [],
  );

  const addImages = useCallback(async () => {
    if (outOfCredits) {
      haptic.warning();
      router.push('/paywall');
      return;
    }
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) return;

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.7,
      base64: true,
    });
    if (picked.canceled) return;

    const next = picked.assets
      .slice(0, remaining)
      .map((a) => ({ uri: a.uri, base64: a.base64 ?? '', mimeType: a.mimeType ?? 'image/jpeg' }));
    if (next.length === 0) return;

    haptic.medium();
    setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
  }, [images.length, outOfCredits]);

  const removeImage = (uri: string) => {
    haptic.light();
    setImages((prev) => prev.filter((img) => img.uri !== uri));
  };

  const scan = useCallback(async () => {
    if (images.length === 0) return;

    haptic.medium();
    setResult(null);
    setStage(0);
    setPhase('working');

    if (stageTimer.current) clearInterval(stageTimer.current);
    stageTimer.current = setInterval(() => {
      setStage((current) => Math.min(current + 1, PROFILE_STAGES[mode].length - 1));
    }, 850);

    try {
      const scanResult = await analyzeProfile({
        images: images.map(({ base64, mimeType }) => ({ base64, mimeType })),
        mode,
      });
      if (!scanResult.isProfile) {
        // Not a profile — don't show results or burn a free scan.
        haptic.warning();
        toast.show(scanResult.rejectionReason ?? "That doesn't look like a profile — try again", 5000);
        setPhase('idle');
        return;
      }
      setResult(scanResult);
      setPhase('done');
      incrementAnalysis();
      haptic.success();
    } catch (error) {
      console.warn('[profile] scan failed', error);
      toast.show('The engine choked — try again');
      setPhase('idle');
    } finally {
      if (stageTimer.current) clearInterval(stageTimer.current);
    }
  }, [images, incrementAnalysis, mode, toast]);

  const reset = () => {
    haptic.light();
    setPhase('idle');
    setImages([]);
    setResult(null);
  };

  /** Switching mode drops the picked images — they were framed for the old question. */
  const changeMode = (next: ScanMode) => {
    if (next === mode) return;
    haptic.selection();
    setMode(next);
    setPhase('idle');
    setImages([]);
    setResult(null);
  };

  const copyLine = async (text: string) => {
    await Clipboard.setStringAsync(text);
    haptic.success();
    toast.show('Copied. Paste it in.');
  };

  const toggleSaveLine = (line: string, index: number) => {
    if (!result) return;
    haptic.light();
    toggleSave({
      id: `profile-${result.id}-bio-${index}`,
      text: line,
      category: 'Bio',
      source: 'bio',
    });
  };

  const isLineSaved = (index: number) =>
    result != null && savedItems.some((item) => item.id === `profile-${result.id}-bio-${index}`);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.sm, paddingBottom: 148 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader icon="scan" title={labels.title} tint={tint} />

        {phase === 'done' && result != null ? (
          <ScanReport
            result={result}
            mode={mode}
            onReset={reset}
            isLineSaved={isLineSaved}
            onCopyLine={(t) => void copyLine(t)}
            onToggleSaveLine={toggleSaveLine}
            onFeedback={() => toast.show('Thanks — noted!')}
            showUpsell={outOfCredits}
          />
        ) : phase === 'working' ? (
          <StagedLoader
            stages={PROFILE_STAGES[mode]}
            stage={stage}
            badge={`SCANNING ${images.length} ${images.length === 1 ? 'IMAGE' : 'IMAGES'}`}
            tint={tint}
          />
        ) : (
          <>
            <View style={styles.modeRow}>
              {SCAN_MODES.map((item) => {
                const active = item.key === mode;
                return (
                  <HapticPressable
                    key={item.key}
                    feedback="none"
                    accessibilityRole="tab"
                    accessibilityLabel={`Scan ${item.label}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => changeMode(item.key)}
                    style={[
                      styles.modePill,
                      active && {
                        backgroundColor: `${item.tint}24`,
                        borderColor: `${item.tint}88`,
                      },
                    ]}
                  >
                    <Text style={styles.modeEmoji}>{item.emoji}</Text>
                    <Text style={[styles.modeLabel, active && { color: palette.textPrimary }]}>
                      {item.label}
                    </Text>
                  </HapticPressable>
                );
              })}
            </View>

            <View style={styles.hero}>
              <Text style={styles.heroTitle}>{labels.heroTitle}</Text>
              <Text style={styles.heroSub}>{labels.heroSub}</Text>
            </View>

            {images.length === 0 ? (
              /* Same drop pad as the Lab — tap opens the multi-picker. */
              <GlowDropZone
                onPress={() => void addImages()}
                locked={outOfCredits}
                title={labels.dropTitle}
                subtitle={labels.dropSubtitle}
                accent={[tint, palette.violet]}
                background={BG.teal}
              />
            ) : (
              <>
                {/* Thumbnails + add */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.thumbRow}
                >
                  {images.map((img) => (
                    <Animated.View key={img.uri} entering={FadeInDown.springify().damping(18)}>
                      <Image source={{ uri: img.uri }} style={styles.thumb} contentFit="cover" />
                      <HapticPressable
                        onPress={() => removeImage(img.uri)}
                        accessibilityLabel="Remove screenshot"
                        hitSlop={8}
                        style={styles.removeBtn}
                      >
                        <Ionicons name="close" size={14} color={palette.textPrimary} />
                      </HapticPressable>
                    </Animated.View>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <HapticPressable
                      onPress={() => void addImages()}
                      accessibilityLabel="Add screenshot"
                      style={[styles.addTile, { borderColor: `${tint}55` }]}
                    >
                      <Ionicons name="add" size={30} color={tint} />
                      <Text style={[styles.addText, { color: tint }]}>Add more</Text>
                    </HapticPressable>
                  )}
                </ScrollView>

                {/* CTA */}
                <HapticPressable
                  onPress={() => void scan()}
                  accessibilityLabel="Scan profile"
                  style={[styles.cta, { backgroundColor: tint }]}
                >
                  <Ionicons name="scan" size={17} color={palette.ink} />
                  <Text style={styles.ctaText}>
                    {`Scan ${images.length} ${images.length === 1 ? 'screenshot' : 'screenshots'}`}
                  </Text>
                </HapticPressable>
              </>
            )}

            <View style={styles.privacyRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={palette.textTertiary} />
              <Text style={styles.privacyText}>Scans are private. Never posted, never shared.</Text>
            </View>
          </>
        )}
      </ScrollView>

      {toast.element}
    </View>
  );
}

const TAB_KEYS = [
  { key: 'quick', emoji: '🏆' },
  { key: 'photo', emoji: '📸' },
  { key: 'comp', emoji: '🏅' },
] as const;
type TabKey = (typeof TAB_KEYS)[number]['key'];

interface ScanReportProps {
  result: ProfileScanResult;
  mode: ScanMode;
  onReset: () => void;
  isLineSaved: (index: number) => boolean;
  onCopyLine: (text: string) => void;
  onToggleSaveLine: (line: string, index: number) => void;
  onFeedback: () => void;
  showUpsell: boolean;
}

function ScanReport({
  result,
  mode,
  onReset,
  isLineSaved,
  onCopyLine,
  onToggleSaveLine,
  onFeedback,
  showUpsell,
}: ScanReportProps) {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<TabKey>('quick');
  const cardWidth = width - spacing.xl * 2 - spacing.md;

  const labels = PROFILE_LABELS[mode];
  const tint = mode === 'self' ? palette.cyan : palette.violet;
  const tabLabels: Record<TabKey, string> = {
    quick: labels.quickWin,
    photo: labels.photo,
    comp: labels.competition,
  };

  const feedback = useRizzStore((s) => s.feedback[result.id]);
  const setFeedback = useRizzStore((s) => s.setFeedback);
  const sendFeedback = (value: 'up' | 'down') => {
    haptic.light();
    setFeedback(result.id, value);
    onFeedback();
  };

  const dateLabel = new Date(result.createdAt).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <View style={styles.report}>
      {/* Profile header */}
      <Animated.View entering={FadeInDown.springify().damping(17)} style={styles.reportHeader}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={22} color={palette.textTertiary} />
        </View>
        <View style={styles.reportHeaderText}>
          <Text style={styles.reportName}>{result.name ?? labels.fallbackName}</Text>
          {result.tagline != null && <Text style={styles.reportTagline}>{result.tagline}</Text>}
        </View>
        <Text style={styles.reportDate}>{dateLabel}</Text>
        <CircleIconButton icon="refresh" size={38} onPress={onReset} accessibilityLabel="Scan a new profile" />
      </Animated.View>

      <Text style={styles.summary}>{result.summary}</Text>

      {/* Scores — two generic slots, named by the active mode. */}
      <ScoreBlock emoji="🔥" label={labels.scoreA} tint={palette.ember} score={result.swipeStopper} />
      <ScoreBlock emoji="🎯" label={labels.scoreB} tint={palette.pink} score={result.intentClarity} />

      {/* The read */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionEmoji}>📸</Text>
          <Text style={styles.sectionTitle}>{labels.workingAndFix}</Text>
        </View>
        {result.workingAndFix.map((para, i) => (
          <Text key={i} style={styles.para}>
            {para}
          </Text>
        ))}
      </View>

      {/* Bio lines ('self') / openers ('them') — both copy+save to the vault. */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionEmoji}>💬</Text>
          <Text style={styles.sectionTitle}>{labels.lines}</Text>
        </View>
        <Text style={styles.hint}>{labels.linesHint}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + spacing.md}
          decelerationRate="fast"
          contentContainerStyle={styles.lineRow}
        >
          {result.bioLines.map((line, i) => (
            <View key={i} style={[styles.lineCard, { width: cardWidth }]}>
              <Text style={styles.lineText}>{line}</Text>
              <View style={styles.lineActions}>
                <CircleIconButton
                  icon={isLineSaved(i) ? 'bookmark' : 'bookmark-outline'}
                  active={isLineSaved(i)}
                  activeColor={palette.mint}
                  onPress={() => onToggleSaveLine(line, i)}
                  accessibilityLabel={isLineSaved(i) ? 'Remove from vault' : 'Save to vault'}
                />
                <CircleIconButton
                  icon="copy-outline"
                  onPress={() => onCopyLine(line)}
                  accessibilityLabel="Copy bio line"
                />
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Tabbed tips */}
      <View style={styles.tabRow}>
        {TAB_KEYS.map((t) => {
          const active = t.key === tab;
          return (
            <HapticPressable
              key={t.key}
              feedback="none"
              accessibilityRole="tab"
              accessibilityLabel={tabLabels[t.key]}
              accessibilityState={{ selected: active }}
              onPress={() => {
                haptic.selection();
                setTab(t.key);
              }}
              style={[styles.tabPill, active && styles.tabPillActive]}
            >
              <Text style={styles.tabEmoji}>{t.emoji}</Text>
              <Text
                style={[styles.tabLabel, active && { color: palette.textPrimary }]}
                numberOfLines={1}
              >
                {tabLabels[t.key]}
              </Text>
            </HapticPressable>
          );
        })}
      </View>

      <Animated.View key={tab} entering={FadeInDown.duration(240)} style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionEmoji}>
            {TAB_KEYS.find((t) => t.key === tab)?.emoji}
          </Text>
          <Text style={styles.sectionTitle}>{tabLabels[tab]}</Text>
        </View>
        {tab === 'quick' ? (
          <Text style={styles.para}>{result.quickWin}</Text>
        ) : (
          (tab === 'photo' ? result.photoTuneUp : result.competition).map((tip, i) => (
            <Bullet key={i} text={tip} tint={tint} />
          ))
        )}
      </Animated.View>

      {/* Disclaimer */}
      <View style={styles.disclaimerRow}>
        <Text style={styles.disclaimerEmoji}>✨</Text>
        <Text style={styles.disclaimer}>
          <Text style={styles.disclaimerBold}>Disclaimer: </Text>
          {labels.disclaimer}
        </Text>
      </View>

      {/* Feedback */}
      <View style={styles.feedbackRow}>
        <CircleIconButton
          icon={feedback === 'up' ? 'thumbs-up' : 'thumbs-up-outline'}
          active={feedback === 'up'}
          activeColor={palette.mint}
          onPress={() => sendFeedback('up')}
          accessibilityLabel="Helpful"
        />
        <CircleIconButton
          icon={feedback === 'down' ? 'thumbs-down' : 'thumbs-down-outline'}
          active={feedback === 'down'}
          activeColor={palette.danger}
          onPress={() => sendFeedback('down')}
          accessibilityLabel="Not helpful"
        />
      </View>

      {showUpsell && <ProUpsellCard onPress={() => router.push('/paywall')} />}
    </View>
  );
}

function ScoreBlock({
  emoji,
  label,
  tint,
  score,
}: {
  emoji: string;
  label: string;
  tint: string;
  score: ProfileScore;
}) {
  const pct = Math.max(0, Math.min(score.score, 10)) * 10;
  return (
    <Animated.View entering={FadeInDown.springify().damping(17)} style={styles.section}>
      <View style={styles.scoreHead}>
        <Text style={styles.sectionEmoji}>{emoji}</Text>
        <Text style={styles.sectionTitle}>{label}</Text>
        <View style={styles.spacer} />
        <Text style={[styles.scoreValue, { color: tint }]}>{score.score}/10</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: tint }]} />
      </View>
      <Text style={styles.para}>{score.note}</Text>
    </Animated.View>
  );
}

function Bullet({ text, tint }: { text: string; tint: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, { backgroundColor: tint }]} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.ink,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  modeEmoji: {
    fontSize: 13,
  },
  modeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textSecondary,
  },
  hero: {
    gap: 6,
    marginTop: spacing.sm,
  },
  heroTitle: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1,
    color: palette.textPrimary,
  },
  heroSub: {
    fontSize: 14.5,
    color: palette.textSecondary,
  },
  thumbRow: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  thumb: {
    width: 104,
    height: 150,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,18,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  addTile: {
    width: 104,
    height: 150,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: radii.full,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: palette.ink,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  privacyText: {
    fontSize: 12,
    color: palette.textTertiary,
  },

  // --- Report ---
  report: {
    gap: spacing.lg,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  reportHeaderText: {
    flex: 1,
    gap: 2,
  },
  reportName: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: palette.textPrimary,
  },
  reportTagline: {
    fontSize: 12.5,
    color: palette.textSecondary,
  },
  reportDate: {
    fontSize: 11.5,
    color: palette.textTertiary,
  },
  summary: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  section: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionEmoji: {
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: palette.textPrimary,
  },
  para: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.textSecondary,
  },
  scoreHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreValue: {
    fontSize: 15,
    fontWeight: '900',
  },
  spacer: {
    flex: 1,
  },
  meterTrack: {
    height: 7,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: radii.full,
  },
  hint: {
    fontSize: 12,
    color: palette.textTertiary,
    textAlign: 'center',
  },
  lineRow: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  lineCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.lg,
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  lineText: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.textPrimary,
  },
  lineActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  tabPillActive: {
    backgroundColor: palette.surfaceHigh,
    borderColor: palette.hairlineStrong,
  },
  tabEmoji: {
    fontSize: 12,
  },
  tabLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: palette.textSecondary,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 8,
    backgroundColor: palette.cyan,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: palette.textSecondary,
  },
  disclaimerRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
  },
  disclaimerEmoji: {
    fontSize: 13,
  },
  disclaimer: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontStyle: 'italic',
    color: palette.textTertiary,
  },
  disclaimerBold: {
    fontWeight: '800',
    color: palette.textSecondary,
  },
  feedbackRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },

});
