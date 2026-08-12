const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * Expo's own flat config, plus one rule promoted to an error.
 *
 * There was no lint configuration at all — `npm run lint` ran `expo lint`
 * against nothing. That mattered more than it usually does here, because this
 * app's state lives in effects with hand-written dependency arrays and the
 * failure mode is silent: a listener that resubscribes on every render, a
 * `useCallback` that captures a stale `images`, a `useMemo` that never
 * recomputes. There is already one `eslint-disable-next-line
 * react-hooks/exhaustive-deps` in `discover.tsx` suppressing a rule that was
 * not running.
 *
 * `eslint-config-expo/flat` is taken wholesale rather than hand-assembled: it is
 * the config Expo tests each SDK against, and hand-rolling a rule list is how
 * you end up subtly diverging from the framework you are using.
 */
module.exports = defineConfig([
  expoConfig,
  {
    /**
     * Expo ships this as a warning. It is an error here.
     *
     * A warning in a codebase with no lint history is a warning nobody will ever
     * clear, and every bug this rule catches in this app is a state bug rather
     * than a style one. If a dependency genuinely must be omitted, the
     * `eslint-disable-next-line` comment with a reason beside it is the right
     * answer — and now it is a deliberate act rather than the default.
     */
    rules: {
      'react-hooks/exhaustive-deps': 'error',

      /**
       * OFF — this rule does not know about Reanimated, and is wrong here.
       *
       * It flags `sharedValue.value = withSpring(...)` as "this value cannot be
       * modified", because to the React Compiler a value read during render must
       * be immutable. A Reanimated shared value is the documented exception: the
       * assignment is the entire API, it happens on the UI thread, and React
       * never re-renders for it. `useSharedValue` is used in ten components here
       * (every `HapticPressable` press, `GlowDropZone`'s pulse, the paywall
       * shimmer) so the rule fires on correct, idiomatic code every time.
       *
       * Reinstate the moment `react-hooks` learns to recognise worklets.
       */
      'react-hooks/immutability': 'off',

      /**
       * WARN, not error — the pattern it flags is sometimes the only option.
       *
       * `setState` inside an effect is usually a cascading-render bug. The two
       * places this app does it are not: `analyzer.tsx` reads accessibility and
       * overlay permissions that were granted in Settings, in another process,
       * and `account.tsx` re-arms the mandatory auth gate after sign-out. Both
       * are "sync React to something React cannot see", which has no other
       * expression.
       *
       * Left visible rather than silenced, so a genuinely cascading one still
       * shows up in the output.
       */
      'react-hooks/set-state-in-effect': 'warn',

      /**
       * OFF — `require()` is load-bearing in this app, not laziness.
       *
       * Five modules use it and all five have to: `react-native-purchases`,
       * `react-native-mmkv`, and the two Firebase SDKs are OPTIONAL native
       * modules that do not exist in Expo Go, on web, or in a build whose config
       * plugin did not run. A static `import` is hoisted and evaluated before
       * any try/catch can protect it, so the app would crash on launch in
       * exactly the environments these guards exist for.
       *
       * They also cannot be dynamic `import()`: Metro resolves from a STRING
       * LITERAL at build time, which is why `analytics.ts` has two near-identical
       * loaders instead of one `load(name)` helper.
       */
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    /*
     * The type scale is enforced, not suggested.
     *
     * `tokens.ts` has always said "never hardcode hex or px in screens". The
     * colour half held — 15 stray literals in the whole client. The type half
     * did not: 215 raw `fontSize` declarations across 31 distinct sizes,
     * including 14.5, 12.5, 11.5, 16.5, 15.5, 13.5 and 10.5. That is why the app
     * read as slightly different on every screen despite one designer's intent.
     *
     * They are all migrated onto the twelve `type` roles now, and emoji onto
     * `glyph` — which is the only reason this rule can have no exceptions. A
     * rule with nine escape hatches is a rule nobody enforces, and the drift
     * comes back one screen at a time.
     *
     * The two files below are exempt for opposite reasons: `theme/` DEFINES the
     * sizes, and `welcome/styles.ts` is a scale model of a phone drawn inside a
     * card, where app type at app sizes neither fits nor reads as a phone. Its
     * overrides still sit on top of a token, so weight, colour and tracking
     * come from the scale.
     */
    files: ['src/**/*.{ts,tsx}', 'modules/**/*.{ts,tsx}'],
    ignores: ['src/theme/**', 'src/screens/welcome/styles.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='fontSize'][value.type='Literal']",
          message:
            'Pick a role from `type` in theme/tokens.ts (or `glyph` for an emoji) instead of a raw fontSize. Twelve roles cover every screen; a new number starts the drift again.',
        },
      ],
    },
  },
  {
    /*
     * Generated or vendored, and not ours to lint. `android/` is CNG output that
     * `expo prebuild` rewrites; `backend/` has its own toolchain and its own
     * tsconfig; `dist/`+`.expo/` are build artefacts.
     */
    ignores: ['android/**', 'ios/**', 'backend/**', 'dist/**', '.expo/**', 'node_modules/**'],
  },
]);
