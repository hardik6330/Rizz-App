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
/**
 * The user signed out and has not signed back in.
 *
 * Persisted, not in-memory: the whole failure mode is a re-auth that happens
 * after a resume, and a launch is a resume. Cleared by `/login` and `/signup`,
 * which are the only two things that may establish an account session.
 */
const SIGNED_OUT_KEY = 'rizz.signedOut';
/** The server's `users.id`. Persisted only so RevenueCat can be told who this is. */
const USER_KEY = 'rizz.userId';
/**
 * The email of the account this install last signed in with.
 *
 * Survives sign-out on purpose, like the install id. It no longer exists to
 * explain a rejection — a device may now hold several accounts, so signup on a
 * claimed install succeeds — but it still saves the user from the question the
 * app cannot answer for them: which of their addresses did they use here. It
 * pre-fills the email field, and that is all it does.
 *
 * Local only, never sent anywhere; cleared by `deleteAccount`, which is the one
 * path that leaves nothing to remember.
 */
const LAST_EMAIL_KEY = 'rizz.lastEmail';

/** The email last signed in on this device, or undefined on a fresh install. */
export function lastAccountEmail(): string | undefined {
  return kv.getString(LAST_EMAIL_KEY);
}
export interface Credits {
  is_pro: boolean;
  analysis_count: number;
  credits_remaining: number | null;
}

interface SessionUser extends Credits {
  /** The server's `users.id` — becomes the RevenueCat App User ID. See `userId()`. */
  id: string;
  /** null = anonymous install, no account attached yet. */
  username: string | null;
}

interface AuthResponse {
  access_token: string;
  /** Only `/v1/auth/device` echoes this; signup and login reuse the stored one. */
  install_id?: string;
  user: SessionUser;
}

/**
 * Persist whatever a session endpoint just returned. One writer for all three of
 * `/device`, `/signup` and `/login`, so a new endpoint cannot forget half of it.
 */
function persistSession(data: AuthResponse, establishesAccount = false): void {
  if (data.install_id) kv.set(INSTALL_KEY, data.install_id);
  kv.set(TOKEN_KEY, data.access_token);
  if (data.user.id) kv.set(USER_KEY, data.user.id);
  onCredits?.(data.user);
  /*
   * Only a SUCCESSFUL /login or /signup lifts the flag, and only here — clearing
   * it at the call site would clear it on a wrong password too, which is the one
   * moment the gate has to hold.
   */
  if (establishesAccount) kv.remove(SIGNED_OUT_KEY);
  /*
   * The STORE owns "am I signed in" — the launch sequence gates on it and has to
   * re-render when it changes, which a bare MMKV read cannot do. Emitted rather
   * than written directly so session.ts stays free of store imports (the store
   * already imports this file; the back-edge would be a cycle).
   *
   * `signedOut` is what makes signing out MEAN anything.
   *
   * `logOut` keeps the install id on purpose — it addresses the user's row, and
   * dropping it would hand out three fresh free analyses per sign-out. But signup
   * CLAIMS the install's row, so that id resolves to the account: the next
   * `/device` re-auth came back with a username attached and quietly signed the
   * user straight back in, on the first resume, with no password. A device
   * session is not an account session, and only `/login` and `/signup` may
   * establish the second one.
   */
  const account = kv.getString(SIGNED_OUT_KEY) ? null : data.user.username ?? null;
  onAccount?.(account);
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

  persistSession(data);
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

// ---------------------------------------------------------------------------
// Account — signup and login, both fronted by an emailed code. There is still no
// password RESET; a code logs you in instead. See backend routes/auth.ts.
// ---------------------------------------------------------------------------

/** `code` mirrors the server envelope so callers branch on it, never the message. */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function postSession(path: string, body: unknown, token?: string): Promise<SessionUser> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const data = (await res.json().catch(() => null)) as (AuthResponse & {
    error?: { code: string; message: string };
  }) | null;

  if (!res.ok || !data?.access_token) {
    throw new AuthError(
      data?.error?.code ?? 'NETWORK',
      // The server's copy is written for the user ("That username is taken"),
      // so it is shown verbatim. It never quotes what was submitted.
      data?.error?.message ?? 'Could not reach RizzCoach — check your connection',
    );
  }

  // `true`: postSession is only ever /signup and /login — the two endpoints that
  // are allowed to establish an account session. /device is not one of them.
  persistSession(data, true);
  return data.user;
}

/**
 * Ask the server to email a six-digit code.
 *
 * **A 2xx now means a code really was sent**, which it did not use to: the
 * endpoint answered ok whether or not it mailed anything, so the UI could only
 * ever say "if that address has an account, the code is on its way". The two
 * cases it was hiding are the two commonest mistakes on this screen — signing up
 * with an address that already has an account, and asking for a recovery code
 * for one that has none — and both left the user waiting on an inbox for a mail
 * that was never sent.
 *
 * They now reject with `EMAIL_TAKEN` / `NO_ACCOUNT`, and account.tsx switches
 * tabs on those codes rather than just printing the message. The trade is that
 * the endpoint can be used to test whether an address has an account; see
 * `Errors.emailTaken` in the backend for what bounds that.
 *
 * Unauthenticated on purpose: recovery has to work on a phone that has been
 * signed out or wiped, where there may be no usable token at all.
 */
export async function requestOtp(email: string, purpose: 'signup' | 'login'): Promise<void> {
  const res = await fetch(apiUrl('/v1/auth/otp'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, purpose }),
    // Longer than the other calls: this one blocks on an SMTP handshake, and the
    // server would rather hold the request than claim a send it has not made.
    signal: AbortSignal.timeout(30_000),
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  throw new AuthError(
    data?.error?.code ?? 'NETWORK',
    data?.error?.message ?? 'Could not reach RizzCoach — check your connection',
  );
}

/**
 * Create an account on the install that is already signed in anonymously.
 *
 * The device token is sent deliberately: the server writes the account onto THAT
 * row, so credits already spent stay spent. It is also what makes login after a
 * reinstall return the original row instead of a fresh set of free analyses.
 *
 * `code` is the one from `requestOtp(email, 'signup')`, and it is what proves the
 * address is real. It is also, indirectly, why a device may now hold more than
 * one account: the server used to reject any signup on a claimed install because
 * an unverified email cost nothing to invent. A verified one does not, so that
 * restriction is gone — a second account on this phone simply inherits the
 * device's spent credits rather than being refused.
 */
export async function signUp(input: {
  username: string;
  email: string;
  password: string;
  code: string;
}): Promise<SessionUser> {
  const user = await postSession('/v1/auth/signup', input, await accessToken());
  // After the await, so a rejected signup never claims to be this device's account.
  kv.set(LAST_EMAIL_KEY, input.email);
  return user;
}

/**
 * Email + password → the original user row, whatever install is asking.
 *
 * The install id goes with it so the server can re-point this device at the row
 * we are about to be handed. Without it login authenticates us as row B while
 * MMKV still addresses row A, and the next `/device` call — up to 30 days later,
 * when the token expires — signs the user out and hands back row A's credits.
 *
 * Read straight from `kv` rather than via `installId()`: that helper calls
 * `accessToken()` when the key is missing, which would mint a fresh anonymous
 * row on the one path whose whole job is to stop doing that. Absent is fine —
 * the server treats it as optional and echoes back whatever it settled on.
 */
export async function logIn(email: string, password: string): Promise<SessionUser> {
  const user = await postSession('/v1/auth/login', {
    email,
    password,
    install_id: kv.getString(INSTALL_KEY),
  });
  // Same as signUp: only a successful login names this device's account.
  kv.set(LAST_EMAIL_KEY, email);
  return user;
}

/**
 * Log in with a mailed code instead of the password. **This is the recovery path.**
 *
 * Same endpoint, same everything else — the server takes a password OR a code
 * and never both. Worth being clear about what it is and is not: it does not
 * reset or change the password, so a stolen inbox cannot lock the real owner
 * out; it only offers a second way to prove the account is yours. Someone who
 * gets back in this way still has whatever password they had, and if they cannot
 * remember it, this is simply how they log in from now on.
 *
 * It also skips the fifteen-minute lockout on purpose — see routes/auth.ts. A
 * user locked out by someone guessing at their password can still get in here,
 * which is the entire point of having it.
 */
export async function logInWithCode(email: string, code: string): Promise<SessionUser> {
  const user = await postSession('/v1/auth/login', {
    email,
    code,
    install_id: kv.getString(INSTALL_KEY),
  });
  kv.set(LAST_EMAIL_KEY, email);
  return user;
}

/**
 * Forget the session on this device.
 *
 * Local only — there is no server-side session to end, and the install id is
 * deliberately KEPT: it still points at the same user row, so a sign-out is not
 * a way to farm three more free analyses.
 */
export function logOut(): void {
  /*
   * Kill the token server-side too, and do not wait for it.
   *
   * Removing the local copy used to be the whole of sign-out, which meant the
   * token stayed valid for the rest of its 30 days on any device, backup or
   * proxy log holding one. `/logout` bumps `users.token_epoch` and every token
   * signed before it stops verifying on the next request.
   *
   * Fire-and-forget on purpose: signing out while offline must still sign you
   * out locally and immediately. The read below happens BEFORE the removes — by
   * the time the request is built the token would be gone.
   */
  const token = kv.getString(TOKEN_KEY);
  if (token && isLiveApi) {
    void fetch(apiUrl('/v1/auth/logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      // Offline. The local sign-out below still stands; the server-side kill is
      // lost, which is the same exposure as before this existed.
    });
  }

  kv.remove(TOKEN_KEY);
  // Dropped so `identify()` puts RevenueCat back to anonymous rather than leaving
  // the previous account's App User ID on a device someone else may now log into.
  // The next `/device` call re-mints it, unchanged, for the same install.
  kv.remove(USER_KEY);
  /*
   * The install id STAYS (see above) — and because signup claimed the install's
   * row, that id resolves to this account. Without this flag the next `/device`
   * re-auth came back with the username attached and signed the user straight
   * back in on the first resume. See persistSession.
   */
  kv.set(SIGNED_OUT_KEY, '1');
  onAccount?.(null);
}

/**
 * Delete the account and every row attached to it, permanently.
 *
 * Required by App Store Review 5.1.1(v) for any app that creates accounts. The
 * install id goes too — the row it pointed at no longer exists, so keeping it
 * would 401 every request until a reinstall.
 */
export async function deleteAccount(): Promise<void> {
  const res = await fetch(apiUrl('/v1/user/me'), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok) throw new AuthError('DELETE_FAILED', 'Could not delete the account — try again');
  kv.remove(TOKEN_KEY);
  kv.remove(INSTALL_KEY);
  kv.remove(USER_KEY);
  // Not "signed out" — there is nothing left to sign back into. The next
  // `/device` mints a genuinely fresh anonymous install, and leaving the flag set
  // would make that new install look permanently logged out of nothing.
  kv.remove(SIGNED_OUT_KEY);
  // The account is gone — remembering its address would offer a login that
  // cannot succeed.
  kv.remove(LAST_EMAIL_KEY);
  void import('@/state/useRizzStore').then(({ useRizzStore }) => {
    useRizzStore.setState({ scanHistory: [] });
  });
  onAccount?.(null);
}

/**
 * The server's `users.id` for this session, or undefined before the first auth.
 *
 * This is what `Purchases.logIn()` is given, so RevenueCat's App User ID is our
 * user id rather than the anonymous `$RCAnonymousID:` the SDK invents. That id
 * is cached on the device and dies with the install — which made restoring a
 * subscription after a reinstall impossible, and collided with `uq_users_rc` on
 * the way. Logging in returns the same `users.id`, so the entitlement comes back
 * with it.
 *
 * Synchronous on purpose: the caller is a `useEffect` that must not await.
 */
export function userId(): string | undefined {
  return kv.getString(USER_KEY);
}

/** The persisted install id, minting one via `/v1/auth/device` if this is a cold install. */
export async function installId(): Promise<string> {
  const existing = kv.getString(INSTALL_KEY);
  if (existing) return existing;
  await accessToken();
  return kv.getString(INSTALL_KEY) ?? '';
}

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
let lastCreditsRefreshAt = 0;
const REFRESH_THROTTLE_MS = 30_000;

export async function refreshCredits(force = false): Promise<void> {
  if (!isLiveApi) return;
  const now = Date.now();
  if (!force && now - lastCreditsRefreshAt < REFRESH_THROTTLE_MS) return;
  lastCreditsRefreshAt = now;
  try {
    const res = await fetch(apiUrl('/v1/user/credits'), {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) return;
    onCredits?.((await res.json()) as Credits);
  } catch {
    // Offline. The cache is still the best guess we have.
  }
}

export interface SavedScanItem {
  id: string;
  mode: 'self' | 'them';
  title: string;
  summary: any;
  createdAt: number;
}

/** Pull saved profile scan reports from the backend DB. */
export async function fetchScans(): Promise<SavedScanItem[]> {
  if (!isLiveApi) return [];
  try {
    const res = await fetch(apiUrl('/v1/user/scans'), {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { scans: SavedScanItem[] };
    return data.scans ?? [];
  } catch {
    return [];
  }
}

/** Delete a scan report from the backend DB by ID. */
export async function deleteScan(id: string): Promise<boolean> {
  if (!isLiveApi) return true;
  try {
    const res = await fetch(apiUrl(`/v1/user/scans/${id}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    return res.ok;
  } catch {
    return false;
  }
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
 * Set once at startup by the store — same pattern and same reason as
 * `onCreditsChanged`. Fires with the username on signup/login and with `null` on
 * sign-out, delete, or a fresh anonymous device.
 */
let onAccount: ((username: string | null) => void) | undefined;

export function onAccountChanged(fn: (username: string | null) => void): void {
  onAccount = fn;
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
