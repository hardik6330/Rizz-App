import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/CircleIconButton';
import { GlowDropZone } from '@/components/GlowDropZone';
import { HapticPressable } from '@/components/HapticPressable';
import { ProUpsellCard } from '@/components/ProUpsellCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StagedLoader } from '@/components/StagedLoader';
import { useToast } from '@/components/Toast';
import {
  addCaptureListener,
  consumePendingCapture,
  hasPendingCapture,
  isSupported,
  isWatching,
  serviceKilled,
} from '@/../modules/profile-capture';
import { BG } from '@/data/assets';
import { PROFILE_LABELS, PROFILE_STAGES, analyzeProfile } from '@/services/profileEngine';
import { isLiveApi } from '@/state/session';
import { useOutOfCredits, useRizzStore } from '@/state/useRizzStore';
import { useLayout, useTabBarClearance } from '@/theme/layout';
import { palette, radii, spacing, type } from '@/theme/tokens';
import type { ProfileCapture, ProfileScanResult, ProfileScore, ScanMode } from '@/types';
import { haptic } from '@/utils/haptics';
import { timeAgo } from '@/utils/misc';
import { useBackToIdle } from '@/utils/useBackToIdle';

type Phase = 'idle' | 'working' | 'done';
type Pick = { uri: string; base64: string; mimeType: string };

const MAX_IMAGES = 3;

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const bottomClearance = useTabBarClearance();
  const toast = useToast();

  /**
   * This tab is for auditing YOUR profile. 'them' is not user-selectable — it is
   * set only when the analyze bubble hands us a capture, because reading someone
   * else's profile is the bubble's job now. The engine still has both modes; only
   * the manual picker is gone.
   */
  const [mode, setMode] = useState<ScanMode>('self');
  const [phase, setPhase] = useState<Phase>('idle');
  const [images, setImages] = useState<Pick[]>([]);
  const [result, setResult] = useState<ProfileScanResult | null>(null);
  const [stage, setStage] = useState(0);
  const [watching, setWatching] = useState(false);
  /**
   * Granted in Settings, but the service is not bound — the OS killed it.
   *
   * Tracked separately from `watching` because the two need different copy and
   * different actions: `!watching` is usually "you have not turned it on yet",
   * which the analyzer screen can fix. This one cannot be fixed from inside the
   * app at all. Re-read on the same beats as `watching`.
   */
  const [killed, setKilled] = useState(false);
  const [scanToDelete, setScanToDelete] = useState<ProfileScanResult | null>(null);
  const account = useRizzStore((state) => state.account);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const labels = PROFILE_LABELS[mode];
  const tint = mode === 'self' ? palette.cyan : palette.violet;

  const savedItems = useRizzStore((state) => state.savedItems);
  const scanHistory = useRizzStore((state) => state.scanHistory);
  const incrementAnalysis = useRizzStore((state) => state.incrementAnalysis);
  const toggleSave = useRizzStore((state) => state.toggleSave);
  const addScan = useRizzStore((state) => state.addScan);
  const removeScan = useRizzStore((state) => state.removeScan);

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
      router.push('/paywall?source=out_of_credits');
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

  /**
   * Runs the scan. `capture` overrides the picked images — the accessibility
   * bubble passes one through so its `uiText` hint reaches the engine.
   */
  const scan = useCallback(async (capture?: ProfileCapture) => {
    const input: ProfileCapture = capture ?? {
      images: images.map(({ base64, mimeType }) => ({ base64, mimeType })),
      mode,
    };
    if (input.images.length === 0) return;
    const activeMode = input.mode ?? mode;

    haptic.medium();
    setResult(null);
    setStage(0);
    setPhase('working');

    if (stageTimer.current) clearInterval(stageTimer.current);
    stageTimer.current = setInterval(() => {
      setStage((current) => Math.min(current + 1, PROFILE_STAGES[activeMode].length - 1));
    }, 850);

    try {
      const scanResult = await analyzeProfile(input);
      if (!scanResult.isProfile) {
        // Not a profile — don't show results or burn a free scan.
        haptic.warning();
        toast.show(scanResult.rejectionReason ?? "That doesn't look like a profile — try again", 5000);
        setPhase('idle');
        // A rejected capture leaves nothing worth keeping: stranding its screenshot
        // in the picker invites the user to re-scan the exact thing just refused.
        if (capture) {
          setImages([]);
          setMode('self');
        }
        return;
      }
      setResult(scanResult);
      setPhase('done');
      addScan(scanResult);
      incrementAnalysis();
      haptic.success();
      /*
       * Release the base64 now the request is done.
       *
       * Up to MAX_IMAGES screenshots were held as base64 STRINGS in this state.
       * Base64 is +33% over the binary and a JS string is UTF-16, so each image
       * costs roughly 2.7× its file size in resident memory — and it was being
       * held for the entire time the report is on screen, which is the longest
       * -lived state this tab has. Three images is several megabytes doing
       * nothing.
       *
       * Safe because nothing reads it again: the only two exits from `done` —
       * `reset()` and `openScan()` — both clear `images` outright, so there is no
       * path that re-scans this array. Only on SUCCESS, though; the failure and
       * rejection branches above leave `phase: 'idle'` with the thumbnails still
       * up, and the user retrying is exactly the case that still needs the bytes.
       *
       * `uri` is kept so anything rendering a thumbnail keeps working — it points
       * at a file on disk and costs nothing to hold.
       */
      setImages((prev) => prev.map((img) => (img.base64 ? { ...img, base64: '' } : img)));
    } catch (error) {
      console.warn('[profile] scan failed', error);
      toast.show('The engine choked — try again');
      setPhase('idle');
    } finally {
      if (stageTimer.current) clearInterval(stageTimer.current);
    }
  }, [addScan, images, incrementAnalysis, mode, toast]);

  /**
   * Pick up a capture from the accessibility bubble.
   *
   * The native service stashes it and launches us; we pull on mount and on
   * resume. Pull rather than push because the service runs when this JS context
   * may not exist — there is often nothing to push an event to.
   *
   * This is also where the freemium gate is applied: the service deliberately
   * knows nothing about credits, so the rule stays in ONE place (`useOutOfCredits`)
   * instead of being reimplemented in Kotlin.
   */
  const takePendingCapture = useCallback(() => {
    if (!isSupported) return;

    /*
     * Peek, then gate, THEN take.
     *
     * This used to consume first and check `outOfCredits` second — so a capture
     * that hit the paywall was already destroyed by the time the paywall opened.
     * `outOfCredits` reads MMKV, which is an optimistic cache: it is stale for a
     * Pro user on a fresh install, and for anyone whose balance changed since the
     * last resume. Dismissing the paywall then left Profile Scan empty with the
     * screenshot gone for good — the user's only recovery was to walk back to the
     * other app and tap ✨ again.
     *
     * Left pending, it is still there when they come back, which is what the
     * focus pull below is for.
     */
    if (!hasPendingCapture()) return;

    if (outOfCredits) {
      haptic.warning();
      router.push('/paywall?source=out_of_credits');
      return;
    }

    const capture = consumePendingCapture();
    if (!capture) return;

    const shot = capture.images[0];
    // Mode comes from the capture: your own profile gets coached, someone else's
    // gets openers. Never assume 'them' — the bubble shows on both.
    setMode(capture.mode ?? 'them');
    setImages([
      { uri: `data:${shot.mimeType};base64,${shot.base64}`, base64: shot.base64, mimeType: shot.mimeType },
    ]);
    void scan(capture);
  }, [outOfCredits, scan]);

  useEffect(() => {
    const onActive = () => {
      takePendingCapture();
      // Permissions are toggled in Settings, outside our process — re-read on resume.
      if (isSupported) {
        setWatching(isWatching());
        setKilled(serviceKilled());
      }
    };
    onActive();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && onActive());
    // The push half. A capture that arrives while this context is already running
    // produces no AppState change, so the resume listener above never fires.
    const capture = addCaptureListener(takePendingCapture);
    return () => {
      sub.remove();
      capture();
    };
  }, [takePendingCapture]);

  // Reflect changes made on the analyzer screen without a full app resume — it
  // is a modal over this tab, so focus is the only signal we get. The account is
  // store state and re-renders on its own.
  //
  // Also the recovery path for a capture parked by the credit gate: dismissing
  // the paywall is a focus change and nothing else, so without this a capture the
  // gate deliberately left pending would sit there unnoticed.
  useFocusEffect(
    useCallback(() => {
      if (isSupported) {
        setWatching(isWatching());
        setKilled(serviceKilled());
      }
      takePendingCapture();
      if (isLiveApi) {
        void import('@/state/session').then(({ fetchScans }) => {
          void fetchScans().then((scans) => {
            const formattedScans = scans.map((item) => ({
              id: item.id,
              mode: item.mode,
              isProfile: true,
              name: item.title,
              createdAt: item.createdAt,
              ...item.summary,
            }));
            useRizzStore.setState({ scanHistory: formattedScans.slice(0, 20) });
          });
        });
      }
    }, [takePendingCapture]),
  );

  /**
   * Back out of a report to the drop pad — which is also where "Recent scans"
   * lives, so the report you just closed is the top row waiting for you.
   *
   * `useCallback` so the hardware-back effect below does not resubscribe on every
   * render, and so `onReset` stays a stable prop.
   */
  const reset = useCallback(() => {
    haptic.light();
    setPhase('idle');
    setImages([]);
    setResult(null);
  }, []);

  // Back out of the report instead of out of the app. See useBackToIdle.
  useBackToIdle(phase === 'done', reset);


  /**
   * Reopen a stored report.
   *
   * The mode comes off the report, never off screen state: a 'them' scan opened
   * while the tab sits in its default 'self' would relabel openers as bio lines.
   * Images are cleared so backing out lands on the drop pad rather than on the
   * thumbnails of whatever was scanned last.
   */
  const openScan = (entry: ProfileScanResult) => {
    haptic.light();
    setMode(entry.mode);
    setImages([]);
    setResult(entry);
    setPhase('done');
  };

  const forgetScan = (entry: ProfileScanResult) => {
    setScanToDelete(entry);
  };

  const confirmDeleteScan = () => {
    if (!scanToDelete) return;
    const entry = scanToDelete;
    setScanToDelete(null);
    removeScan(entry.id);
    if (isLiveApi) {
      void import('@/state/session').then(({ deleteScan }) => {
        void deleteScan(entry.id);
      });
    }
    toast.show('Removed from history');
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
          {
            paddingHorizontal: gutter,
            paddingTop: insets.top + spacing.sm,
            paddingBottom: bottomClearance,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader icon="scan" title={labels.title} tint={tint} />

        {phase === 'done' && result != null ? (
          <ScanReport
            result={result}
            mode={result.mode}
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
            <View style={styles.hero}>
              <Text style={styles.heroTitle} maxFontSizeMultiplier={1.25}>
                {labels.heroTitle}
              </Text>
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

            {/* One-tap analyzer — Android only, hidden where the module is absent. */}
            {isSupported && (
              <HapticPressable
                onPress={() => {
                  haptic.light();
                  router.push('/analyzer');
                }}
                accessibilityLabel="Analyzer settings"
                style={styles.analyzerRow}
              >
                <Ionicons
                  name={killed ? 'warning' : watching ? 'sparkles' : 'sparkles-outline'}
                  size={16}
                  color={killed ? palette.gold : palette.violet}
                />
                <View style={styles.analyzerText}>
                  <Text style={styles.analyzerTitle}>
                    {killed ? 'Analyzer was stopped' : watching ? 'Analyzing profiles' : 'Read profiles'}
                  </Text>
                  <Text style={styles.analyzerSub}>
                    {/*
                      * Three states, not two.
                      *
                      * `killed` is granted-in-Settings-but-not-running: the OS
                      * ended our process and never rebound the service, which is
                      * what MIUI/ColorOS/FuntouchOS do on swipe-away. The generic
                      * "turn it on" copy is actively wrong there — it points at a
                      * switch that is already on, and nothing in the app can fix
                      * it. Only Settings can.
                      */}
                    {killed
                      ? 'Your phone stopped it in the background. Tap here, then switch RizzCoach off and on again in Accessibility.'
                      : watching
                        ? 'Open a profile in Instagram, Tinder, Bumble or Hinge — or any chat in WhatsApp, Snapchat & Telegram — and tap ✨.'
                        : 'Turn on to get an ✨ button in Instagram, Tinder, Bumble, Hinge, WhatsApp, Snapchat & Telegram.'}
                  </Text>
                </View>
                {(!watching || killed) && <View style={styles.analyzerDot} />}
                <Ionicons name="chevron-forward" size={15} color={palette.textTertiary} />
              </HapticPressable>
            )}

            {/*
              * Account row.
              *
              * Signed-in ONLY. The "Save your credits" prompt that used to sit
              * here is gone: an account is now mandatory at launch, so a
              * signed-out user cannot reach this screen and the branch was dead.
              *
              * The row itself stays — it is the only route to sign out.
              *
              * It is NO LONGER a route to account deletion: that button was
              * removed from account.tsx by request. App Store Review 5.1.1(v)
              * requires in-app deletion for any app that creates accounts, and
              * signup is mandatory here, so a reviewer has nowhere to find one.
              * See the note on SignedIn in account.tsx.
              */}
            {isLiveApi && account != null && (
              <HapticPressable
                onPress={() => {
                  haptic.light();
                  router.push('/account');
                }}
                accessibilityLabel={`Account, signed in as ${account}`}
                style={styles.analyzerRow}
              >
                <Ionicons name="person-circle" size={16} color={palette.mint} />
                <View style={styles.analyzerText}>
                  <Text style={styles.analyzerTitle} numberOfLines={1}>
                    @{account}
                  </Text>
                  <Text style={styles.analyzerSub}>
                    Your credits and Pro follow this account to any phone.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={palette.textTertiary} />
              </HapticPressable>
            )}

            {/*
              * Past reports, below the analyzer row rather than above it.
              *
              * Kept on this screen rather than in the Vault: the Vault holds
              * individual lines to send, a report is the whole analysis, and this is
              * where someone looks for "that scan I ran". It sits after the analyzer
              * row so the scan funnel — drop pad, then how to get the ✨ button — is
              * never pushed down the page by a list that grows to 20 rows.
              *
              * The icon and tint are the ONLY place mode surfaces in the UI: cyan
              * person for your own profile, violet magnifier for someone else's.
              * There is no mode selector — mode is decided by the capture, and
              * `openScan` reads it back off the stored report.
              */}
            {scanHistory.length > 0 && (
              <View style={styles.history}>
                <Text style={styles.historyTitle}>Recent scans</Text>
                {scanHistory.map((entry) => {
                  const entryTint = entry.mode === 'self' ? palette.cyan : palette.violet;
                  return (
                    <HapticPressable
                      key={entry.id}
                      onPress={() => openScan(entry)}
                      accessibilityLabel={`Open scan of ${entry.name ?? PROFILE_LABELS[entry.mode].fallbackName}`}
                      style={styles.historyRow}
                    >
                      <View
                        style={[
                          styles.historyIcon,
                          { backgroundColor: `${entryTint}1A`, borderColor: `${entryTint}55` },
                        ]}
                      >
                        <Ionicons
                          name={entry.mode === 'self' ? 'person-outline' : 'search-outline'}
                          size={14}
                          color={entryTint}
                        />
                      </View>
                      {/* minWidth 0 + flexShrink: the name must ellipsize, not shove
                        * the timestamp and the remove button out of the gutter. */}
                      <View style={styles.historyText}>
                        <Text style={styles.historyName} numberOfLines={1}>
                          {entry.name ?? PROFILE_LABELS[entry.mode].fallbackName}
                        </Text>
                        <Text style={styles.historyMeta} numberOfLines={1}>
                          {timeAgo(entry.createdAt)}
                          {entry.tagline != null ? ` · ${entry.tagline}` : ''}
                        </Text>
                      </View>
                      <HapticPressable
                        onPress={() => forgetScan(entry)}
                        accessibilityLabel="Remove from history"
                        hitSlop={10}
                        style={styles.historyRemove}
                      >
                        <Ionicons name="close" size={14} color={palette.textTertiary} />
                      </HapticPressable>
                    </HapticPressable>
                  );
                })}
              </View>
            )}

            <View style={styles.privacyRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={palette.textTertiary} />
              <Text style={styles.privacyText}>Scans are private. Never posted, never shared.</Text>
            </View>
          </>
        )}
      </ScrollView>

      {toast.element}

      {/* ── Remove scan confirmation modal ──────────────────────────────── */}
      <Modal
        visible={scanToDelete != null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setScanToDelete(null)}
      >
        <Pressable
          style={styles.scrim}
          accessibilityLabel="Dismiss"
          onPress={() => setScanToDelete(null)}
        >
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>Remove Scan?</Text>
            <Text style={styles.dialogBody}>
              Are you sure you want to remove this scan from your history? It will be deleted permanently.
            </Text>
            <View style={styles.dialogActions}>
              <HapticPressable
                onPress={() => setScanToDelete(null)}
                accessibilityLabel="Cancel"
                style={styles.dialogGhost}
              >
                <Text style={styles.dialogGhostText}>Cancel</Text>
              </HapticPressable>
              <HapticPressable
                onPress={confirmDeleteScan}
                accessibilityLabel="Confirm remove scan"
                style={styles.dialogDanger}
              >
                <Text style={styles.dialogDangerText}>Remove</Text>
              </HapticPressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  history: {
    gap: spacing.sm,
  },
  historyTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: palette.textTertiary,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  historyIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* `minWidth: 0` is what lets the name ellipsize instead of pushing the
   * timestamp and the remove button past the gutter — see AGENTS.md. */
  historyText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  historyName: {
    fontSize: 14,
    fontWeight: '800',
    color: palette.textPrimary,
    flexShrink: 1,
  },
  historyMeta: {
    fontSize: 11,
    color: palette.textTertiary,
    flexShrink: 1,
  },
  historyRemove: {
    padding: spacing.xs,
  },
  analyzerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: `${palette.violet}44`,
  },
  analyzerDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: palette.violet,
  },
  analyzerText: {
    flex: 1,
    gap: 2,
  },
  analyzerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  analyzerSub: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.textTertiary,
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
    fontSize: 12,
    lineHeight: 16,
  },
  tabLabel: {
    // React Native defaults flexShrink to 0 (unlike the web), so without this the
    // label refuses to shrink and spills outside the pill — numberOfLines cannot
    // ellipsize text that was never given a bounded width.
    flexShrink: 1,
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

  // ── Confirmation Dialog ────────────────────────────────────────────────────
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(3,3,8,0.72)',
  },
  dialog: {
    alignSelf: 'stretch',
    maxWidth: 400,
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  dialogTitle: { ...type.h2 },
  dialogBody: { ...type.bodyMuted, fontSize: 14 },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dialogGhost: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
  },
  dialogGhostText: { fontSize: 14.5, fontWeight: '700', color: palette.textSecondary },
  dialogDanger: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,92,92,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,92,92,0.4)',
  },
  dialogDangerText: { fontSize: 14.5, fontWeight: '700', color: palette.danger },
});
