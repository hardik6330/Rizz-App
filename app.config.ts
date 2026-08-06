import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic config layered over `app.json`.
 *
 * Everything static lives in app.json and is passed in here as `config`. This file
 * exists for the one part that CANNOT be static: the iOS home-screen widget, which
 * needs an Apple Developer Team ID.
 *
 * That ID is a credential, so it cannot be committed — and the placeholder that used
 * to sit in app.json (`REPLACE_WITH_APPLE_TEAM_ID`) did not fail loudly. It failed at
 * signing, deep inside an EAS build, after the queue wait. Which meant iOS could not
 * be built at all, by anyone, without first knowing to go and edit a string.
 *
 * So the widget is now OPT-IN and its absence is the safe default:
 *
 *   APPLE_TEAM_ID unset → no widget target, no app-group entitlement, no push
 *                         entitlement. The app builds for iOS immediately, including
 *                         on a simulator with no paid account. `widgetBridge.ts`
 *                         already no-ops when the native module is absent, so nothing
 *                         breaks — this is exactly the case it was written for.
 *
 *   APPLE_TEAM_ID set   → the widget target, the shared App Group and the extension
 *                         entitlements are all restored, identical to what app.json
 *                         declared before.
 *
 * Set it in the EAS environment (not .env, which is gitignored and never uploaded):
 *   eas env:create --environment preview --name APPLE_TEAM_ID --value ABCDE12345
 *
 * Locally, for `expo prebuild -p ios`:  APPLE_TEAM_ID=ABCDE12345 npx expo prebuild -p ios
 */

const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID ?? '';

/** An Apple Team ID is 10 alphanumeric characters. Anything else is a stub. */
const hasTeamId = /^[A-Z0-9]{10}$/i.test(APPLE_TEAM_ID);

/**
 * Firebase (Analytics + Crashlytics) is OPT-IN, for the same reason the widget is.
 *
 * `google-services.json` is a per-project file that cannot be committed, and the
 * Google Services Gradle plugin **hard-fails the build** when it is missing —
 * not at config time, but deep inside a Gradle task after the EAS queue wait.
 * Wiring the plugins unconditionally would mean nobody could build Android until
 * they knew to go and fetch a file.
 *
 * So: env var unset → no Firebase plugins → the app builds exactly as it does
 * today, and `services/analytics.ts` no-ops because the native module is absent.
 * Set → Analytics and Crashlytics switch on with no code change.
 *
 * Gated on the env var rather than on the file being present, to match
 * APPLE_TEAM_ID above — one opt-in mechanism in this file, not two — and because
 * EAS supplies the file through exactly this variable anyway.
 *
 * Get it from the Firebase console (Project settings → Your apps → Android,
 * package `com.rizzcoach.app`). Locally:
 *   GOOGLE_SERVICES_JSON=./google-services.json npx expo prebuild -p android
 * In EAS, upload it as a file-type secret and the variable becomes its path:
 *   eas env:create --environment preview --name GOOGLE_SERVICES_JSON \
 *     --type file --value ./google-services.json
 */
/*
 * These are the ONLY place `googleServicesFile` is set.
 *
 * app.json used to declare both paths unconditionally while gitignoring both
 * files, which made the opt-in below dead code: a clean clone always failed at
 * the Gradle google-services task, which is the deep-in-the-build-queue failure
 * this whole mechanism exists to prevent. Never put them back in app.json.
 */
const GOOGLE_SERVICES_JSON = process.env.GOOGLE_SERVICES_JSON ?? '';
const GOOGLE_SERVICES_PLIST = process.env.GOOGLE_SERVICES_PLIST ?? '';
const hasFirebaseAndroid = GOOGLE_SERVICES_JSON.length > 0;
const hasFirebaseIos = GOOGLE_SERVICES_PLIST.length > 0;
const hasFirebase = hasFirebaseAndroid || hasFirebaseIos;

const FIREBASE_PLUGINS = [
  '@react-native-firebase/app',
  '@react-native-firebase/crashlytics',
];

export default ({ config }: ConfigContext): ExpoConfig => {
  let base = config as ExpoConfig;

  if (hasFirebase) {
    base = {
      ...base,
      // Only declare the platform that was actually configured — pointing at a
      // missing file is the same hard Gradle failure this branch exists to avoid.
      ...(hasFirebaseAndroid
        ? { android: { ...base.android, googleServicesFile: GOOGLE_SERVICES_JSON } }
        : {}),
      ...(hasFirebaseIos
        ? { ios: { ...base.ios, googleServicesFile: GOOGLE_SERVICES_PLIST } }
        : {}),
      plugins: [...(base.plugins ?? []), ...FIREBASE_PLUGINS],
    };
  }

  if (!hasTeamId) {
    // The common path: a complete, buildable iOS app without the widget.
    return base;
  }

  /*
   * ONLY the plugin is added here.
   *
   * app.json used to also declare the App Group entitlement and the
   * `extra.eas.build.experimental.ios.appExtensions` target by hand. Both are
   * redundant: the plugin generates them from `src` + `devTeamId`. Declaring them
   * as well produced a duplicated app-group entitlement and TWO identical
   * appExtensions entries in the resolved config — verified with
   * `expo config --type public`. Duplicate extension targets and duplicate
   * entitlements are a provisioning failure waiting for a build queue to find it.
   *
   * The hand-written `aps-environment: production` went with them. Nothing in this
   * app registers for push, and an unused Push Notifications capability is one more
   * thing to justify at App Store review for zero benefit. Add it back the day push
   * actually ships.
   */
  return {
    ...base,
    plugins: [
      ...(base.plugins ?? []),
      [
        '@bittingz/expo-widgets',
        {
          ios: {
            src: 'widgets/ios',
            devTeamId: APPLE_TEAM_ID,
            mode: 'production',
            moduleDependencies: [],
            useLiveActivities: false,
            frequentUpdates: false,
          },
        },
      ],
    ],
  };
};
