import type { StateStorage } from 'zustand/middleware';

/**
 * Synchronous key-value backend for the store.
 *
 * Production builds use MMKV (fast, encrypted-capable, JSI-based). MMKV v4 is a
 * Nitro module, so it is unavailable inside Expo Go and on web — there we fall
 * back to an in-memory Map so the whole app still runs (state just won't
 * survive a reload until you run a dev build).
 */
type KVBackend = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
};

function createBackend(): { kv: KVBackend; kind: 'mmkv' | 'memory' } {
  try {
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    const mmkv = createMMKV({ id: 'rizzcoach' });
    return {
      kind: 'mmkv',
      kv: {
        getString: (key) => mmkv.getString(key),
        set: (key, value) => mmkv.set(key, value),
        remove: (key) => mmkv.remove(key),
      },
    };
  } catch {
    const memory = new Map<string, string>();
    return {
      kind: 'memory',
      kv: {
        getString: (key) => memory.get(key),
        set: (key, value) => {
          memory.set(key, value);
        },
        remove: (key) => {
          memory.delete(key);
        },
      },
    };
  }
}

const backend = createBackend();

/**
 * The memory fallback is a DEV convenience and a production data-loss bug.
 *
 * Nothing read the backend kind, so the fallback was silent — and silent means the
 * install id never persists, which means `/v1/auth/device` mints a brand-new
 * anonymous `users` row on **every single launch**. Each one carries its own
 * free-analysis allowance, so the failure mode is unbounded row growth and
 * unbounded free credits, and the only symptom is the signup gate appearing
 * every time you open the app.
 *
 * Crashing is the correct response in a release build. An app that quietly
 * forgets who you are on every launch is not degraded, it is broken, and it is
 * broken in a way that costs money per launch.
 */
if (backend.kind === 'memory' && !__DEV__) {
  throw new Error(
    'MMKV is unavailable in a release build — refusing to run with unpersisted storage',
  );
}
if (backend.kind === 'memory') {
  console.warn(
    '[storage] MMKV unavailable (Expo Go or web) — state is in-memory and will NOT survive a reload.\n' +
      '          Every launch will create a new anonymous account on the server. Use a dev build.',
  );
}

/**
 * Raw key-value access, for state that is not UI state.
 *
 * `services/auth.ts` keeps the install id and access token here rather than in the
 * zustand store: nothing renders them, so putting them in the store would wake
 * every subscriber on a token refresh, and they must not appear in `partialize`
 * alongside things a "clear my data" action is allowed to wipe.
 */
export const kv = backend.kv;

export const zustandStorage: StateStorage = {
  getItem: (name) => backend.kv.getString(name) ?? null,
  setItem: (name, value) => backend.kv.set(name, value),
  removeItem: (name) => backend.kv.remove(name),
};
