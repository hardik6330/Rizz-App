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

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;

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
