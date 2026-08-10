import { DarkTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  addCaptureListener,
  configureChat,
  consumeChatUsage,
  hasPendingCapture,
  isSupported,
} from '@/../modules/profile-capture';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { FREE_ANALYSIS_LIMIT } from '@/constants';
import { identify, initPurchases } from '@/services/purchases';
import { syncDailyOpenerToWidget } from '@/services/widgetBridge';
import { apiBase, installId, isLiveApi, refreshCredits } from '@/state/session';
import { useRizzStore } from '@/state/useRizzStore';
import { palette } from '@/theme/tokens';

export const unstable_settings = {
  anchor: '(tabs)',
};

/**
 * The app-wide crash screen. Expo Router picks this up BY NAME — it must be
 * exported as `ErrorBoundary` from a route file or it is inert.
 *
 * This is the outermost one: it catches a throw in the auth gate, which is the
 * only screen with nothing behind it to fall back to. `(tabs)/_layout.tsx`
 * exports the same component again, and Expo Router prefers the nearest
 * boundary — so a broken tab is contained to that tab and this one only sees
 * what happens above the tab tree.
 */
export { AppErrorBoundary as ErrorBoundary };

/**
 * Hold the splash until we know whether the account gate is needed.
 *
 * The plugin is configured in app.json but nothing ever called this, so the
 * splash hid on the very first frame — which is why a signed-out launch showed
 * the Lab tab, and only then slid the mandatory signup screen over the top. The
 * user saw the app they are not allowed into yet, and a redirect that reads like
 * a bug.
 *
 * The store is MMKV-backed and rehydrates SYNCHRONOUSLY, so `account` is already
 * correct on the first render — there was never anything to wait for. The gap
 * was entirely the 400ms timer that used to schedule the push.
 *
 * Module scope, not an effect: an effect runs after the first frame, which is
 * the frame we are trying not to show. Rejection is ignored because it only
 * means the splash is already gone.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});

/** Not exported — expo-router treats unexpected route exports as a mistake. */
function hideSplash(): void {
  // Already-hidden rejects, and that is the success case here.
  void SplashScreen.hideAsync().catch(() => {});
}

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
  /**
   * Step 1 of 2: the account. **Mandatory — there is no way past it.**
   *
   * Not "first launch": this runs on EVERY launch until an account exists. There
   * is no skip, no ✕ and no back gesture out of `/account` while it is showing
   * (see the onboarding branch in that file). Signing up or logging in is the
   * only exit.
   *
   * The trade, stated plainly because it is real: this screen lands before the
   * user has seen a single result, so every install that will not hand over an
   * email is lost here rather than at the paywall. What it buys is that an
   * uninstall no longer resets the free-credit count — logging in returns the
   * original user row. Watch install → first-analysis conversion; if it falls
   * hard, the fix is to move this gate after the first free analysis rather than
   * to soften it into a skippable prompt, which converts nobody and blocks
   * nobody.
   *
   * Gated on `isLiveApi` — with no API configured there is no account to make,
   * and a wall the user cannot possibly pass is a bricked app.
   *
   * Declared FIRST because the capture router below reads it: while the gate is
   * up there is no `/profile` route to send a capture to.
   */
  const account = useRizzStore((s) => s.account);
  const accountStepDone = !isLiveApi || account != null;

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
      /*
       * `accountStepDone` is load-bearing, not a nicety.
       *
       * While the gate is up, `(tabs)` is not declared at all, so `/profile` is
       * not a route and this navigate is a silent no-op. Re-running when the gate
       * clears is what delivers a capture taken by a signed-out user: they tap ✨,
       * land on signup, create an account, and the screenshot they already took is
       * waiting rather than lost. `hasPendingCapture` no longer consumes, so it
       * survives every attempt that finds no route to go to.
       */
      if (accountStepDone && hasPendingCapture()) router.navigate('/profile');
    };
    route();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && route());
    // Fires when a capture lands while we are already running — the case AppState
    // cannot see, because bringing an already-foreground task forward is not a
    // state change. See modules/profile-capture addCaptureListener.
    const capture = addCaptureListener(route);
    return () => {
      sub.remove();
      capture();
    };
  }, [accountStepDone]);

  /**
   * Pull the server's true balance on launch and on every resume.
   *
   * **This used to live inside the chat-bubble effect below, behind that
   * effect's `isSupported` guard** — and `isSupported` is
   * `Platform.OS === 'android' && native != null`. So the app's only credit
   * reconciliation was Android-only: on iOS, in Expo Go, and in any dev client
   * without the native module, `analysisCount` never came back from the server
   * after launch. It ran entirely on the optimistic MMKV cache plus whatever the
   * last AI response returned, and a credit spent on another device was never
   * seen at all.
   *
   * That guard belongs to the bubble. Credits belong to every platform, so they
   * get their own effect. Silent on failure by design — this is a
   * reconciliation, not a gate; the server still owns the real decision.
   */
  useEffect(() => {
    void refreshCredits();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshCredits();
    });
    return () => sub.remove();
  }, []);

  /**
   * Keep the native chat bubble's entitlement snapshot in sync with JS.
   *
   * The inline chat reply is generated natively and never launches the app, so —
   * unlike the profile flow — there is no mount where JS can apply the freemium
   * rule. So we push the rule's INPUTS down (isPro + free credits left) on launch
   * and every resume, and drain the credits the native side burned. See
   * modules/profile-capture ChatEntitlement.
   */
  useEffect(() => {
    if (!isSupported) return;
    const sync = async () => {
      /*
       * The drain is the OFFLINE fallback now, not the primary count.
       * `incrementAnalysis` no-ops against a live API — `reportCredits` and the
       * effect above own the number there — because counting in both places is
       * exactly the double-count that was costing every free user an analysis.
       * See the note on `incrementAnalysis` in useRizzStore.
       */
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

  /*
   * Keep RevenueCat's identity pointed at the signed-in account.
   *
   * One effect covers signup, login and sign-out, because all three are the same
   * store write. Doing it at the two call sites in `account.tsx` instead is how
   * one of them eventually forgets, and a forgotten `logIn` is a subscriber who
   * cannot restore after a reinstall.
   */
  useEffect(() => {
    void identify();
  }, [account]);
  /**
   * First launch, step 2 of 3: the three setup questions.
   *
   * `coach == null` is the flag — see the note on it in `useRizzStore`. Gated on
   * `accountStepDone` so the modals queue rather than race, exactly like the
   * analyzer step below, and it comes BEFORE the analyzer because the analyzer
   * screen is a permission ask and this one is what tells a new user what the app
   * is for at all.
   *
   * Unlike the analyzer there is no "shown once" flag: the answers ARE the flag,
   * so a user who somehow escapes without answering is asked again next launch.
   */
  const coach = useRizzStore((s) => s.coach);
  const coachStepDone = coach != null;

  /** Did the gate actually run this session? Gates the landing below. */
  const onboardedThisSession = useRef(false);

  useEffect(() => {
    if (!accountStepDone || coachStepDone) return;
    onboardedThisSession.current = true;
    const t = setTimeout(() => router.push('/onboarding'), 400);
    return () => clearTimeout(t);
  }, [accountStepDone, coachStepDone]);
  useEffect(() => {
    if (accountStepDone) {
      // Nothing to gate — this IS the app, so show it.
      hideSplash();
      return;
    }
    onboardedThisSession.current = true;
    /*
     * No push. `(tabs)` is removed from the navigator below while the gate is
     * up, so `/account` is the only route that exists and the router is already
     * there — there is no navigation to schedule and nothing to land on top of.
     *
     * Pushing was the bug. A push happens after the tabs have mounted and
     * painted, so the Lab screen was on display for the whole transition no
     * matter how the transition was configured, and the splash could only ever
     * hide the part of it that came before `account.tsx` mounted. Removing the
     * route removes the frame.
     */

    /*
     * Dead-man's switch. If `account.tsx` never mounts, the splash would stay up
     * for ever and the app would look bricked with nothing in the log. Better a
     * flash than a black screen.
     */
    const t = setTimeout(hideSplash, 3000);
    return () => clearTimeout(t);
  }, [accountStepDone]);

  /**
   * First launch, step 3 of 3: walk the user through enabling the analyzer. The
   * feature is invisible until accessibility is granted, and accessibility has no
   * permission prompt — it can only be reached by hand in Settings — so without
   * this the headline feature is undiscoverable.
   *
   * Waits on `accountStepDone` AND `coachStepDone` so the three modals queue
   * instead of racing: the effects run on the same mount, and pushing analyzer
   * while another is animating in leaves the user on whichever won.
   *
   * Shown once. `hasOnboarded` is set on dismissal whether or not they granted
   * anything: nagging every launch is worse than letting them find it in Profile
   * Scan, which is why the entry point lives there permanently.
   */
  const hasOnboarded = useRizzStore((s) => s.hasOnboarded);
  useEffect(() => {
    if (!isSupported || hasOnboarded || !accountStepDone || !coachStepDone) return;
    onboardedThisSession.current = true;
    const t = setTimeout(() => router.push('/analyzer'), 400);
    return () => clearTimeout(t);
  }, [hasOnboarded, accountStepDone, coachStepDone]);

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
    if (!accountStepDone || !coachStepDone) return;
    // On iOS/web there is no analyzer step, so account + setup is the whole run.
    if (isSupported && !hasOnboarded) return;
    onboardedThisSession.current = false;
    router.navigate('/profile');
  }, [accountStepDone, coachStepDone, hasOnboarded]);

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
          {/*
            Declared FIRST, and outside the guard, so it is the route the
            navigator falls back to when everything below is removed. A guarded
            screen is not hidden, it is not declared at all — so while the gate
            is up `/account` is the whole app and the Lab tab has no frame to
            render in. That is the fix: not a faster redirect, no redirect.

            It is still a modal the rest of the time, opened from the account
            row on Profile Scan. `account.tsx` reads the store to tell the two
            apart — see `isOnboarding` there.
          */}
          <Stack.Screen
            name="account"
            options={
              accountStepDone
                ? { presentation: 'modal' }
                // gestureEnabled off while it is the gate: signing out from the
                // modal leaves this screen presented as one, and an iOS
                // swipe-to-dismiss would drop the user out of the only route that
                // exists. Android's hardware back is handled in account.tsx.
                : { animation: 'none', gestureEnabled: false }
            }
          />
          <Stack.Protected guard={accountStepDone}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="vault" options={{ presentation: 'modal' }} />
            {/*
              gestureEnabled off for the same reason as the account gate: the
              setup answers are what every engine personalises from, and an iOS
              swipe-dismiss would leave a user with none of them and no way back
              to the questions. Android's hardware back is handled in the screen.
            */}
            <Stack.Screen
              name="onboarding"
              options={{ presentation: 'modal', gestureEnabled: false }}
            />
            <Stack.Screen name="analyzer" options={{ presentation: 'modal' }} />
            <Stack.Screen
              name="paywall"
              options={{ presentation: 'modal', gestureEnabled: false }}
            />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
