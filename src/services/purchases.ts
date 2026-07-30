import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';

import { PRO_ENTITLEMENT_ID } from '@/constants';
import { isLiveRevenueCatKey } from '@/state/limits';
import { installId, isLiveApi, syncPro } from '@/state/session';
import { setProProperty, track } from './analytics';
import { useRizzStore } from '@/state/useRizzStore';
import { wait } from '@/utils/misc';

/**
 * RevenueCat wrapper with a full mock mode.
 *
 * - Real device build + a real store key → live offerings and purchases.
 * - Expo Go / web / stubbed key → mock plans and a simulated purchase flow so
 *   the paywall is fully demoable.
 *
 * The native module is loaded lazily inside a try/catch because
 * react-native-purchases cannot run inside Expo Go.
 *
 * ⚠️ Each platform needs its OWN key — Apple keys are `appl_`, Google Play keys
 * are `goog_`. When this file checked only for `appl_`, every Android build fell
 * through to mock mode, where `purchasePlan` grants Pro for free after a 1.4s
 * fake sheet. Both keys must be set before shipping the platform they gate.
 */

const RC_KEY =
  Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY,
  }) ?? '';
const isLiveKey = isLiveRevenueCatKey(RC_KEY);

export interface Plan {
  id: string;
  title: string;
  price: string;
  period: string;
  sub?: string;
  badge?: string;
}

export const MOCK_PLANS: Plan[] = [
  { id: 'weekly', title: 'Weekly', price: '$6.99', period: '/ week', sub: 'Commitment issues? Respect.' },
  { id: 'annual', title: 'Annual', price: '$39.99', period: '/ year', sub: 'Works out to $0.77 a week', badge: 'BEST VALUE' },
  { id: 'lifetime', title: 'Lifetime', price: '$79.99', period: 'once', sub: 'One payment. Infinite aura.' },
];

type PurchasesModule = typeof import('react-native-purchases').default;

let purchasesModule: PurchasesModule | null | undefined;
let configured = false;
let livePackages: Record<string, PurchasesPackage> = {};

function getPurchases(): PurchasesModule | null {
  if (purchasesModule !== undefined) return purchasesModule;
  try {
    const mod = require('react-native-purchases');
    purchasesModule = (mod.default ?? mod) as PurchasesModule;
  } catch {
    // Native module unavailable (Expo Go / web) — run in mock mode.
    purchasesModule = null;
  }
  return purchasesModule;
}

function syncEntitlement(info: CustomerInfo) {
  void applyPro(info.entitlements.active[PRO_ENTITLEMENT_ID] != null);
}

/**
 * Apply an entitlement locally AND tell the server.
 *
 * Setting it locally alone is what the app used to do, and it is now not enough:
 * the credit gate lives on the server and reads `is_pro` off the user row, so a
 * subscriber who never syncs is cut off after three analyses. The local write
 * still happens first so the paywall dismisses instantly.
 *
 * Never throws — a failed sync must not turn a completed purchase into an error
 * dialog. The next launch retries.
 */
async function applyPro(isPro: boolean): Promise<void> {
  useRizzStore.getState().setPro(isPro);
  // Segments every other funnel by plan status.
  setProProperty(isPro);
  if (!isLiveApi) return;

  try {
    const Purchases = getPurchases();
    // Mock mode has no RevenueCat identity, but rc_app_user_id is UNIQUE — a
    // shared literal would collide across devices, so key it on the install.
    const appUserId =
      Purchases && configured ? await Purchases.getAppUserID() : `mock:${await installId()}`;
    await syncPro(appUserId, isPro);
  } catch (error) {
    console.warn('[purchases] entitlement sync failed — retrying next launch', error);
  }
}

/** Call once at app launch (root layout). Safe to call in any environment. */
export async function initPurchases(): Promise<void> {
  const Purchases = getPurchases();
  if (!Purchases || !isLiveKey) return; // mock mode

  try {
    Purchases.configure({ apiKey: RC_KEY });
    configured = true;
    Purchases.addCustomerInfoUpdateListener(syncEntitlement);
    syncEntitlement(await Purchases.getCustomerInfo());
  } catch (error) {
    console.warn('[purchases] configure failed — staying in mock mode', error);
    configured = false;
  }
}

function titleFor(packageType: string): string {
  switch (packageType) {
    case 'WEEKLY':
      return 'Weekly';
    case 'MONTHLY':
      return 'Monthly';
    case 'ANNUAL':
      return 'Annual';
    case 'LIFETIME':
      return 'Lifetime';
    default:
      return 'Pro';
  }
}

function periodFor(packageType: string): string {
  switch (packageType) {
    case 'WEEKLY':
      return '/ week';
    case 'MONTHLY':
      return '/ month';
    case 'ANNUAL':
      return '/ year';
    case 'LIFETIME':
      return 'once';
    default:
      return '';
  }
}

/** Fetch display plans — live RevenueCat offerings, or mock plans. */
export async function fetchPlans(): Promise<Plan[]> {
  const Purchases = getPurchases();
  if (Purchases && configured) {
    try {
      const offerings = await Purchases.getOfferings();
      const packages = offerings.current?.availablePackages ?? [];
      if (packages.length > 0) {
        livePackages = {};
        return packages.map((pkg) => {
          livePackages[pkg.identifier] = pkg;
          const packageType = String(pkg.packageType);
          return {
            id: pkg.identifier,
            title: titleFor(packageType),
            price: pkg.product.priceString,
            period: periodFor(packageType),
            badge: packageType === 'ANNUAL' ? 'BEST VALUE' : undefined,
          };
        });
      }
    } catch (error) {
      console.warn('[purchases] getOfferings failed — using mock plans', error);
    }
  }
  await wait(650); // let the skeleton breathe in mock mode
  return MOCK_PLANS;
}

/** Purchase a plan. Resolves true when Pro is unlocked, false on cancel/failure. */
export async function purchasePlan(planId: string): Promise<boolean> {
  const Purchases = getPurchases();
  const pkg = livePackages[planId];

  if (Purchases && configured && pkg) {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      syncEntitlement(customerInfo);
      const unlocked = customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] != null;
      if (unlocked) track({ name: 'pro_purchased', plan: planId, mock: false });
      return unlocked;
    } catch (error) {
      const cancelled = (error as { userCancelled?: boolean })?.userCancelled === true;
      if (!cancelled) console.warn('[purchases] purchase failed', error);
      return false;
    }
  }

  // Mock purchase — simulate the App Store sheet round-trip. `mock: true` keeps
  // free grants out of the conversion numbers; without it a preview build with a
  // stub RevenueCat key reads as a 100% paywall conversion rate.
  await wait(1400);
  await applyPro(true);
  track({ name: 'pro_purchased', plan: planId, mock: true });
  return true;
}

/** Restore previous purchases. Resolves true when Pro is active afterwards. */
export async function restorePurchases(): Promise<boolean> {
  const Purchases = getPurchases();
  if (Purchases && configured) {
    try {
      const info = await Purchases.restorePurchases();
      syncEntitlement(info);
      return info.entitlements.active[PRO_ENTITLEMENT_ID] != null;
    } catch (error) {
      console.warn('[purchases] restore failed', error);
      return false;
    }
  }
  await wait(900);
  return useRizzStore.getState().isPro;
}
