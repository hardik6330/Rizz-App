import { DarkTheme, Stack, ThemeProvider, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  configureChat,
  consumeChatUsage,
  hasPendingCapture,
  isSupported,
} from '@/../modules/profile-capture';
import { FREE_ANALYSIS_LIMIT } from '@/constants';
import { initPurchases } from '@/services/purchases';
import { syncDailyOpenerToWidget } from '@/services/widgetBridge';
import { accountUsername, apiBase, installId, isLiveApi, refreshCredits } from '@/state/session';
import { useRizzStore } from '@/state/useRizzStore';
import { palette } from '@/theme/tokens';

export const unstable_settings = {
  anchor: '(tabs)',
};

const RizzTheme: typeof DarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.ink,
    card: palette.ink,
    border: palette.hairline,
    primary: palette.violet,
    text: palette.textPrimary,
  },
};

export default function RootLayout() {
  useEffect(() => {
    // Fire-and-forget boot work: RevenueCat + push today's opener to the widget.
    void initPurchases();
    syncDailyOpenerToWidget();
  }, []);

  /**
   * The analyze bubble launches us with a capture waiting, but the app lands on
   * the Lab tab — and the capture is consumed by the Profile Scan tab, which is
   * not mounted. Without this the screenshot is taken, the app opens, and nothing
   * ever renders it.
   *
   * Routing here rather than in the tab: only the root is guaranteed to be mounted
   * on a cold start. The peek is non-destructive, so Profile Scan still gets the
   * capture once it mounts.
   */
  useEffect(() => {
    if (!isSupported) return;
    const route = () => {
      if (hasPendingCapture()) router.navigate('/profile');
    };
    route();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && route());
    return () => sub.remove();
  }, []);

  /**
   * Keep the native chat bubble's entitlement snapshot in sync with JS.
   *
   * The inline chat reply is generated natively and never launches the app, so —
   * unlike the profile flow — there is no mount where JS can apply the freemium
   * rule. So we push the rule's INPUTS down (isPro + free credits left + the Gemini
   * key) on launch and every resume, and drain the credits the native side burned
   * back into `analysisCount`. Reconcile BEFORE computing the snapshot so the
   * balance we push already reflects the just-consumed usage. See
   * modules/profile-capture ChatEntitlement.
   */
  useEffect(() => {
    if (!isSupported) return;
    const sync = async () => {
      const consumed = consumeChatUsage();
      const store = useRizzStore.getState();
      for (let i = 0; i < consumed; i++) store.incrementAnalysis();
      // The bubble charges the server directly, so a reply generated while the app
      // was closed is invisible to MMKV. Pull the truth BEFORE deriving the
      // snapshot below, or we push a stale balance back over an accurate one.
      await refreshCredits();
      const { isPro, analysisCount } = useRizzStore.getState();
      const remaining = isPro ? 9999 : Math.max(0, FREE_ANALYSIS_LIMIT - analysisCount);
      // The install id, never a token: the bubble fires days after the app was
      // last opened, by which point a 24h token is dead. And never the Gemini
      // key — nothing native can call Google any more.
      void installId().then((id) => configureChat(apiBase(), id, isPro, remaining));
    };
    void sync();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sync();
    });
    return () => sub.remove();
  }, []);

  /**
   * First launch, step 1 of 2: the account.
   *
   * Shown before the analyzer walkthrough so the sequence reads as one
   * onboarding rather than two unrelated modals. `/account` handles the rest —
   * `onboarding=1` gives it a skip affordance and the welcome framing.
   *
   * SKIPPABLE, deliberately. This lands before the user has seen a single
   * result, and a wall there is the highest-drop-off screen an app can have.
   * `hasSeenAuth` is set on dismissal whether or not they signed up, exactly
   * like `hasOnboarded` — the account row on Profile Scan is the permanent
   * entry point, so nothing is lost by letting them past.
   *
   * To make it MANDATORY: drop `|| hasSeenAuth` below and remove the skip in
   * `account.tsx`. Measure activation before and after; the cost is usually
   * larger than the reinstall farming it prevents.
   *
   * Gated on `isLiveApi` — with no API configured there is no account to make,
   * and the screen would only be able to say so.
   */
  const hasSeenAuth = useRizzStore((s) => s.hasSeenAuth);
  const accountStepDone = !isLiveApi || hasSeenAuth || accountUsername() != null;
  /** Did first-run actually run this session? Gates the landing below. */
  const onboardedThisSession = useRef(false);
  useEffect(() => {
    if (accountStepDone) return;
    onboardedThisSession.current = true;
    const t = setTimeout(() => router.push('/account?onboarding=1'), 400);
    return () => clearTimeout(t);
  }, [accountStepDone]);

  /**
   * First launch, step 2 of 2: walk the user through enabling the analyzer. The
   * feature is invisible until accessibility is granted, and accessibility has no
   * permission prompt — it can only be reached by hand in Settings — so without
   * this the headline feature is undiscoverable.
   *
   * Waits on `accountStepDone` so the two modals queue instead of racing: both
   * effects run on the same mount, and pushing analyzer while account is
   * animating in leaves the user on whichever won.
   *
   * Shown once. `hasOnboarded` is set on dismissal whether or not they granted
   * anything: nagging every launch is worse than letting them find it in Profile
   * Scan, which is why the entry point lives there permanently.
   */
  const hasOnboarded = useRizzStore((s) => s.hasOnboarded);
  useEffect(() => {
    if (!isSupported || hasOnboarded || !accountStepDone) return;
    onboardedThisSession.current = true;
    const t = setTimeout(() => router.push('/analyzer'), 400);
    return () => clearTimeout(t);
  }, [hasOnboarded, accountStepDone]);

  /**
   * Land on Profile Scan when first-run finishes, not on the Lab.
   *
   * `unstable_settings.anchor` puts the app on the Lab tab, which is right for
   * every later launch. But onboarding just finished explaining the ✨ analyzer,
   * and the analyzer's permanent home — along with the account row and the scan
   * history — is Profile Scan. Dropping the user on a different tab makes the
   * walkthrough they just read look like it was about something else.
   *
   * Only after BOTH steps resolve, and only in a session that actually showed
   * one: the ref keeps a normal launch on the Lab.
   */
  useEffect(() => {
    if (!onboardedThisSession.current) return;
    if (!accountStepDone) return;
    // On iOS/web there is no analyzer step, so the account step is the whole run.
    if (isSupported && !hasOnboarded) return;
    onboardedThisSession.current = false;
    router.navigate('/profile');
  }, [accountStepDone, hasOnboarded]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={RizzTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.ink },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="vault" options={{ presentation: 'modal' }} />
          <Stack.Screen name="analyzer" options={{ presentation: 'modal' }} />
          <Stack.Screen name="account" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="paywall"
            options={{ presentation: 'modal', gestureEnabled: false }}
          />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
