import type { CoachProfile, ProfileScanResult, ScanMode } from '@/types';

import {
  accessToken,
  apiUrl,
  authedFetch,
  isLiveApi,
  reportCredits,
  storeAccessToken,
  type Credits,
} from './auth';

/**
 * Everything under `/v1/user` — credits, the vault, scan history, the coach
 * answers, and the entitlement push.
 *
 * These are the app's *account-data* calls, as distinct from the AI calls in
 * `api.ts` and the session calls in `auth.ts`. They share one convention, and it
 * is load-bearing:
 *
 *   - **`null` / `false` means "could not ask"** — offline, or a token that could
 *     not be refreshed. Callers must treat it as "keep what you have locally",
 *     never as "the server says you have nothing".
 *   - **`[]` is authoritative.** The server really does have no rows.
 *
 * Each still opens with its own `if (!isLiveApi)` line rather than sharing one.
 * That branch is the demo-mode switch the whole app is built around, and a
 * reader of any single function has to be able to see what it does offline
 * without following a helper.
 *
 * Every call goes through `authedFetch`, which carries the bearer token and
 * retries once on 401. Before the split these were eight hand-rolled fetches
 * with no refresh, so an expired token silently stopped the vault, the coach
 * answers and the scan history from syncing at all.
 */

let lastCreditsRefreshAt = 0;
const REFRESH_THROTTLE_MS = 30_000;

/**
 * Pull the server's true balance into the store. Launch and every resume.
 *
 * The bubble spends credits in a process the store cannot see: the accessibility
 * service charges `/v1/ai/chat` directly and only mirrors the result into its own
 * SharedPreferences snapshot. Without this the meter still reads 3/3 after a
 * dozen bubble replies, and — worse — `_layout.tsx` then pushes that stale number
 * back down, overwriting the accurate snapshot the service just wrote.
 *
 * Silent on failure: it is a reconciliation, not a gate. MMKV stays an optimistic
 * cache so the paywall still appears without a round trip.
 */
export async function refreshCredits(force = false): Promise<void> {
  if (!isLiveApi) return;
  const now = Date.now();
  if (!force && now - lastCreditsRefreshAt < REFRESH_THROTTLE_MS) return;
  lastCreditsRefreshAt = now;

  const res = await authedFetch('/v1/user/credits');
  if (!res?.ok) return;
  const data = (await res.json().catch(() => null)) as Credits | null;
  if (data) reportCredits(data);
}

export interface SavedScanItem {
  id: string;
  mode: ScanMode;
  title: string;
  /**
   * The report body as `POST /v1/ai/profile` stored it — the whole result
   * payload, so it carries its own `id` and `name` and the caller spreads it
   * last. Typed rather than `any` so `profile.tsx` reassembling a
   * `ProfileScanResult` from it is checked; `createdAt` and `mode` are columns
   * beside the blob, not inside it.
   */
  summary: Omit<ProfileScanResult, 'createdAt' | 'mode'>;
  createdAt: number;
}

/** Saved profile scan reports. `null` means "could not ask" — see the note above. */
export async function fetchScans(): Promise<SavedScanItem[] | null> {
  if (!isLiveApi) return null;
  const res = await authedFetch('/v1/user/scans');
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { scans?: SavedScanItem[] } | null;
  return data?.scans ?? [];
}

/** Delete a scan report by id. */
export async function deleteScan(id: string): Promise<boolean> {
  if (!isLiveApi) return true;
  return (await authedFetch(`/v1/user/scans/${id}`, { method: 'DELETE' }))?.ok ?? false;
}

/**
 * A page of saved vault items.
 *
 * The `null` return is the whole point of the type. This used to answer `[]` for
 * both "the server says you have saved nothing" and "we are offline / the token
 * bounced / mock mode", which left every caller guessing — and the guess they all
 * made was `if (items.length > 0)`, so a genuinely emptied vault could never sync
 * and a local copy could never be cleared from another device.
 */
export interface VaultPage {
  items: { id: string; category: string; text: string; note?: string; savedAt: number }[];
  /** The server held back older rows — see `hydrateVault`, which must merge rather than replace. */
  hasMore: boolean;
}

export async function fetchVault(): Promise<VaultPage | null> {
  if (!isLiveApi) return null;
  const res = await authedFetch('/v1/user/vault');
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as
    | { items?: VaultPage['items']; has_more?: boolean }
    | null;
  if (!data) return null;
  // `has_more` absent means a server older than the cap — treat as complete,
  // which is what it was.
  return { items: data.items ?? [], hasMore: data.has_more ?? false };
}

/** JSON body + the header it needs. The four writers below all send one. */
function jsonBody(method: 'POST', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Save or update a single vault item. */
export async function saveVaultItem(item: {
  id: string;
  category: string;
  text: string;
  note?: string;
  savedAt: number;
}): Promise<boolean> {
  if (!isLiveApi) return true;
  return (await authedFetch('/v1/user/vault', jsonBody('POST', item)))?.ok ?? false;
}

/** Delete a single vault item by id. */
export async function deleteVaultItem(id: string): Promise<boolean> {
  if (!isLiveApi) return true;
  return (await authedFetch(`/v1/user/vault/${id}`, { method: 'DELETE' }))?.ok ?? false;
}

/** Clear every vault item for this user. */
export async function clearVaultItems(): Promise<boolean> {
  if (!isLiveApi) return true;
  return (await authedFetch('/v1/user/vault', { method: 'DELETE' }))?.ok ?? false;
}

/**
 * Save or update the onboarding coach answers.
 *
 * `CoachProfile`, not loose strings: `/v1/user/coach` validates against closed
 * enums, so a value TypeScript would have let through here is a 400 at runtime.
 */
export async function saveCoachProfile(coach: CoachProfile): Promise<boolean> {
  if (!isLiveApi) return true;
  return (await authedFetch('/v1/user/coach', jsonBody('POST', coach)))?.ok ?? false;
}

/**
 * Push entitlement to the server and take the re-issued token.
 *
 * The response REPLACES the access token: the old one still asserts the old `pro`
 * claim, and the credit gate reads entitlement off the user row, so without this
 * a subscriber is cut off after three analyses.
 *
 * The one call here that throws rather than folding to `false`. A silent failure
 * would leave a paying user on the free tier with nothing to show them, so
 * `purchases.ts` gets a real error to report — which also means it must NOT go
 * through `authedFetch`, whose whole contract is to swallow the network error.
 * The 401 refresh is hand-written below instead.
 *
 * `claimedPro` is only consulted while the server has no RevenueCat secret key —
 * the same mock mode the app already runs in when the SDK key is a stub.
 */
export async function syncPro(rcAppUserId: string, claimedPro: boolean): Promise<boolean> {
  if (!isLiveApi) return claimedPro;

  const send = async (force: boolean) =>
    fetch(apiUrl('/v1/user/pro'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await accessToken(force)}`,
      },
      body: JSON.stringify({ rc_app_user_id: rcAppUserId, claimed_pro: claimedPro }),
    });

  let res = await send(false);
  if (res.status === 401) res = await send(true);
  if (!res.ok) throw new Error(`pro sync failed (${res.status})`);

  const data = (await res.json()) as { access_token: string } & Credits;
  storeAccessToken(data.access_token);
  reportCredits(data);
  return data.is_pro;
}
