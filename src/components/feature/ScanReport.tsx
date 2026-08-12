import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { ProUpsellCard } from '@/components/feature/ProUpsellCard';
import { track } from '@/services/analytics';
import { PROFILE_LABELS } from '@/services/profileEngine';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
import { glyph, palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { ProfileScanResult, ProfileScore, ScanMode } from '@/types';
import { haptic } from '@/utils/haptics';

/**
 * The Profile Scan report — everything the screen shows once `phase` is 'done'.
 *
 * Lifted out of `profile.tsx`, which was 1,257 lines and did two unrelated jobs:
 * capture (pick images, run the scan, keep history) and render. This half reads
 * nothing but its props and two feedback selectors, so it moved whole.
 *
 * It stays ONE component across both scan modes on purpose. `PROFILE_LABELS[mode]`
 * renames every section — a 'them' report shows openers where 'self' shows bio
 * lines — while the shape underneath is identical. Two renderers would be two
 * places to fix a layout bug, and `ScanMode` already fails to compile until every
 * per-mode map has an entry.
 */

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

export function ScanReport({
  result,
  mode,
  onReset,
  isLineSaved,
  onCopyLine,
  onToggleSaveLine,
  onFeedback,
  showUpsell,
}: ScanReportProps) {
  const { width, gutter } = useLayout();
  const [tab, setTab] = useState<TabKey>('quick');
  // Peek the next card. Must track the live gutter — on a tablet the gutter is
  // most of the screen, and the old `spacing.xl * 2` made these cards wider
  // than the column they sit in.
  const cardWidth = width - gutter * 2 - spacing.md;

  const labels = PROFILE_LABELS[mode];
  const tint = mode === 'self' ? palette.cyan : palette.violet;
  /** Short on the pill, full in the section heading — three long labels truncate. */
  const tabLabels: Record<TabKey, string> = {
    quick: labels.tabs.quick,
    photo: labels.tabs.photo,
    comp: labels.tabs.comp,
  };
  const sectionTitles: Record<TabKey, string> = {
    quick: labels.quickWin,
    photo: labels.photo,
    comp: labels.competition,
  };

  const feedback = useRizzStore((s) => s.feedback[result.id]);
  const setFeedback = useRizzStore((s) => s.setFeedback);
  /**
   * Records the rating AND reports it. Both halves are needed.
   *
   * The store write is what lights the icon on a report the user reopens later;
   * on its own it was the whole feature, which made the toast — "Thanks —
   * noted!" — untrue. Nobody was noted. A thumbs-down sat in MMKV on one phone
   * until the app was uninstalled, so the single quality signal this product can
   * collect was being thrown away at the moment it was given.
   *
   * `track` carries the engine and the verdict only; see the union's own note on
   * why the report itself is not attached.
   */
  const sendFeedback = (value: 'up' | 'down') => {
    haptic.light();
    setFeedback(result.id, value);
    track({ name: 'report_feedback', engine: 'profile', value });
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
        {/* Fixed-width neighbours either side: never let the date push them off. */}
        <Text style={styles.reportDate} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {dateLabel}
        </Text>
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
                maxFontSizeMultiplier={1.2}
              >
                {tabLabels[t.key]}
              </Text>
            </HapticPressable>
          );
        })}
      </View>

      <Animated.View key={tab} entering={FadeInDown.duration(240)} style={styles.section}>
        {/* The active pill already names the section; repeating it verbatim below
            just cost a line of vertical space. Only show the fuller heading when it
            actually says more than the pill does. */}
        {sectionTitles[tab] !== tabLabels[tab] && (
          <View style={styles.sectionHead}>
            <Text style={styles.sectionEmoji}>
              {TAB_KEYS.find((t) => t.key === tab)?.emoji}
            </Text>
            <Text style={styles.sectionTitle}>{sectionTitles[tab]}</Text>
          </View>
        )}
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

      {showUpsell && <ProUpsellCard onPress={() => router.push('/paywall?source=upsell_card')} />}
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
    ...typo.h3,
    fontWeight: '800',
  },
  reportTagline: {
    ...typo.caption,
    fontWeight: '400',
  },
  reportDate: {
    ...typo.caption,
    fontWeight: '400',
    color: palette.textTertiary,
  },
  summary: {
    ...typo.reply,
    fontWeight: '600',
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
    fontSize: glyph.lg,
  },
  sectionTitle: {
    ...typo.h3,
    fontWeight: '800',
  },
  para: {
    ...typo.bodyMuted,
  },
  scoreHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreValue: {
    ...typo.body,
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
    ...typo.caption,
    fontWeight: '400',
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
    ...typo.reply,
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
    // A flex child's default minWidth lets its content force the pill wider than
    // its share of the row. 0 lets it actually shrink.
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radii.full,
    // Belt and braces: nothing escapes the pill even if a label is long.
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  tabPillActive: {
    backgroundColor: palette.surfaceHigh,
    borderColor: palette.hairlineStrong,
  },
  tabEmoji: {
    fontSize: glyph.sm,
    lineHeight: 16,
  },
  tabLabel: {
    // React Native defaults flexShrink to 0 (unlike the web), so without this the
    // label refuses to shrink and spills outside the pill — numberOfLines cannot
    // ellipsize text that was never given a bounded width.
    ...typo.caption,
    flexShrink: 1,
    fontWeight: '700',
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
    ...typo.bodyMuted,
    flex: 1,
  },
  disclaimerRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
  },
  disclaimerEmoji: {
    fontSize: glyph.md,
  },
  disclaimer: {
    ...typo.caption,
    flex: 1,
    fontWeight: '400',
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
