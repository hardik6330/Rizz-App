import { Platform } from 'react-native';

import { kv } from './storage';

/**
 * Anonymous device session for the RizzCoach API.
 *
 * There is no login. Identity is an install id the server mints on first launch
 * and this device keeps forever, traded for a 24h JWT. No email, no password, no
 * PII — the same anonymity the app has always had, now with a server that can
 * actually enforce a credit limit.
 *
 * The install id is a bearer credential: whoever holds it owns those credits. It
 * lives in MMKV and is never logged, never sent anywhere but `/v1/auth/device`.
 */

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/**
 * Is a real API configured?
 *
 * Replaces the old `isLiveKey`. Same contract — false means every engine serves
 * its mock seeds and the app still demos offline — but the thing being checked
 * is now a URL we host instead of a Google key shipped inside the bundle.
 */
export const isLiveApi = /^https?:\/\/.+/.test(API_URL);

const INSTALL_KEY = 'rizz.installId';
const TOKEN_KEY = 'rizz.accessToken';

export interface Credits {
  is_pro: boolean;
  analysis_count: number;
  credits_remaining: number | null;
}

interface AuthResponse {
  access_token: string;
  install_id: string;
  user: Credits;
}

/** Deduped: a cold start fires several engines at once and must not race for tokens. */
let inFlight: Promise<string> | null = null;

async function authenticate(): Promise<string> {
  const res = await fetch(`${API_URL}/v1/auth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Omitted on first launch; the server mints one and returns it.
      install_id: kv.getString(INSTALL_KEY),
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      app_version: process.env.EXPO_PUBLIC_APP_VERSION,
    }),
  });

  if (!res.ok) throw new Error(`auth failed (${res.status})`);
  const data = (await res.json()) as AuthResponse;

  kv.set(INSTALL_KEY, data.install_id);
  kv.set(TOKEN_KEY, data.access_token);
  onCredits?.(data.user);
  return data.access_token;
}

/**
 * A valid access token, minting one if needed.
 *
 * `force` is used by the single 401 retry in `api.ts` — the cached token has
 * expired or the entitlement changed under it.
 */
export async function accessToken(force = false): Promise<string> {
  if (!force) {
    const cached = kv.getString(TOKEN_KEY);
    if (cached) return cached;
  } else {
    kv.remove(TOKEN_KEY);
  }
  inFlight ??= authenticate().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

/** The persisted install id, minting one via `/v1/auth/device` if this is a cold install. */
export async function installId(): Promise<string> {
  const existing = kv.getString(INSTALL_KEY);
  if (existing) return existing;
  await accessToken();
  return kv.getString(INSTALL_KEY) ?? '';
}

/**
 * Push entitlement to the server and take the re-issued token.
 *
 * Lives here rather than in `api.ts` because the response replaces the access
 * token: the old one still asserts the old `pro` claim, and the credit gate
 * reads entitlement off the user row, so without this a subscriber is cut off
 * after three analyses.
 *
 * `claimedPro` is only consulted while the server has no RevenueCat secret key —
 * the same mock mode the app already runs in when the SDK key is a stub.
 */
export async function syncPro(rcAppUserId: string, claimedPro: boolean): Promise<boolean> {
  if (!isLiveApi) return claimedPro;

  const res = await fetch(apiUrl('/v1/user/pro'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
    },
    body: JSON.stringify({ rc_app_user_id: rcAppUserId, claimed_pro: claimedPro }),
  });
  if (!res.ok) throw new Error(`pro sync failed (${res.status})`);

  const data = (await res.json()) as { access_token: string } & Credits;
  kv.set(TOKEN_KEY, data.access_token);
  onCredits?.(data);
  return data.is_pro;
}

/**
 * Set once at startup by the store, so `session.ts` stays free of store imports
 * (`useRizzStore` → `limits` → nothing; a back-edge here would be a cycle).
 */
let onCredits: ((credits: Credits) => void) | undefined;

export function onCreditsChanged(fn: (credits: Credits) => void): void {
  onCredits = fn;
}

/** Called by `api.ts` on every successful response so the store tracks the truth. */
export function reportCredits(credits: Credits): void {
  onCredits?.(credits);
}

/**
 * The configured API base, or '' when unset.
 *
 * Exported for `configureChat()`: the Android accessibility service needs the
 * URL to call, and it cannot import from `api.ts` because it runs in a process
 * where the JS context may not exist.
 */
export function apiBase(): string {
  return API_URL;
}
