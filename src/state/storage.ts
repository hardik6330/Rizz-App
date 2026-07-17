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

/** 'mmkv' in dev/production builds, 'memory' in Expo Go / web. */
export const storageKind = backend.kind;

export const zustandStorage: StateStorage = {
  getItem: (name) => backend.kv.getString(name) ?? null,
  setItem: (name, value) => backend.kv.set(name, value),
  removeItem: (name) => backend.kv.remove(name),
};
