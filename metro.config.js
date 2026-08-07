const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

/**
 * Expo's default Metro config, plus one resolver rule.
 *
 * This file exists ONLY to drop modules that a dependency pulls into the bundle
 * and this app can never reach. Nothing else is customised — everything below
 * `getDefaultConfig` is the stock Expo pipeline, and it must stay that way.
 *
 * ## Why a resolver, and not an import change
 *
 * The usual fix for a fat bundle is to stop importing the fat thing. That does
 * not work here: neither module is imported by `src/` at all. They arrive
 * through OTHER packages' `require` graphs, and Metro follows every static
 * `require` regardless of whether the branch containing it can execute. There is
 * no import to delete, so the resolver is the only layer that can answer.
 *
 * ## What is stubbed, and the evidence it is dead
 *
 * **expo-symbols** — 934 KB, and the single largest asset in the bundle: it
 * carries `@expo-google-fonts/material-symbols`, a full Google Material Symbols
 * font. It enters via
 * `expo-router/build/native-tabs/utils/materialIconConverter.android.js`, which
 * is part of expo-router's **NativeTabs** API.
 *
 * This app does not use NativeTabs. `app/(tabs)/_layout.tsx` imports `Tabs` from
 * `expo-router/js-tabs` explicitly and renders a custom `FloatingTabBar`.
 *
 * Safe to stub because of HOW that file uses it: module scope only does
 * `require("expo-symbols")` and never reads a property off it. The one
 * dereference — `unstable_getMaterialSymbolSourceAsync` — sits inside a
 * `loader: () => …` callback that only NativeTabs invokes. An empty object is
 * therefore indistinguishable from the real module until code that cannot run,
 * runs.
 *
 * **@react-native-firebase/\*** — stubbed ONLY when Firebase is not configured
 * for this build. This closes a gap between two layers that were already meant
 * to agree: `app.config.ts` makes Firebase opt-in natively, adding its plugins
 * only when `GOOGLE_SERVICES_JSON` / `GOOGLE_SERVICES_PLIST` is set. But the JS
 * side could not follow, because `services/analytics.ts` reaches it through
 * `require('@react-native-firebase/analytics')` — a static string literal, which
 * Metro resolves at build time no matter what the surrounding `try/catch` does.
 * So an unconfigured build shipped the whole Firebase JS SDK to no-op around it.
 *
 * The same env vars gate both layers now, so they cannot disagree. Set them and
 * the real modules resolve exactly as before — this is not a removal, it is the
 * JS half of an opt-in that already existed.
 *
 * Safe to stub because `analytics.ts` already handles a missing native module:
 * it calls `mod.default()` inside a `try`, and `undefined()` on the stub throws
 * a TypeError into the same `catch` that Expo Go already lands in. That is the
 * documented "native module absent" path, not a new one.
 *
 * ## When to delete an entry here
 *
 * The moment the app starts using the feature. If NativeTabs is ever adopted,
 * remove the `expo-symbols` line or the tab bar renders no icons — and it will
 * fail silently, which is why this comment is this long.
 */
const STUB = path.resolve(__dirname, 'metro-empty-module.js');

/** Matches the gate in app.config.ts. One switch for the native and JS halves. */
const firebaseConfigured = Boolean(
  process.env.GOOGLE_SERVICES_JSON || process.env.GOOGLE_SERVICES_PLIST,
);

const STUBBED = new Set([
  'expo-symbols',
  ...(firebaseConfigured
    ? []
    : [
        '@react-native-firebase/app',
        '@react-native-firebase/analytics',
        '@react-native-firebase/crashlytics',
      ]),
]);

const config = getDefaultConfig(__dirname);

// Chained, not replaced: `getDefaultConfig` may already have installed a
// resolveRequest, and overwriting it would silently disable whatever it does.
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (STUBBED.has(moduleName)) {
    return { type: 'sourceFile', filePath: STUB };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
